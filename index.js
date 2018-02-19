const config = require('./config');
const promptly = require('promptly');
const spawn = require('child_process').spawn;
const Table = require('easy-table');
const fs = require('fs');
const moment = require('moment');

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
  // Stack Trace
  console.log(reason.stack);
});

function debug(...args) {
  // console.log('DEBUG', ...args);
}

function log(...args) {
  console.log(...args);
}

function Kubectl(cluster) {
  if (!cluster) throw new Error('Word of advice: Working with multiple clusters without explicitly choosing one is bound to get you fired eventually!');

  return (cmd) => {
    const command = `kubectl --cluster ${cluster} ${cmd} -o json`;
    debug('Running: ' + command);
    const child = spawn('sh', ['-c', command], { stdio: [null, 'pipe', 'inherit']})

    let jsonString = '';
    child.stdout.on('data', data => jsonString += data.toString());

    return new Promise((resolve, reject) => child.on('close', code => {

      debug(`Exited with code ${code}`);

      let json = {};
      try {
        json = JSON.parse(jsonString);
      } catch (e) {
        console.error(jsonString);
        console.error(e);
        return reject(new Error('Failed to parse JSON from response'));
      }

      resolve(json);
    }));
  }
}

function GitLocal(path) {
  const stat = fs.statSync(path);
  if (!stat.isDirectory()) throw new Error(`${path} is not a directory!`);

  return (cmd) => {
    const command = `git --git-dir ${path}/.git --work-tree ${path} ${cmd}`;
    debug('Running: ' + command);
    const child = spawn('sh', ['-c', command], { stdio: [null, 'pipe', 'inherit'] })

    let string = '';
    child.stdout.on('data', data => string += data.toString());

    return new Promise((resolve, reject) => child.on('close', code => {

      debug(`Exited with code ${code}`);

      resolve(string);
    }));
  }
}

async function run(config) {

  let cluster = config.cluster;
  if (!cluster) {
    const clusters = config.clusters.split(',');
    log('Available clusters (choose by numbering):');
    clusters.forEach((name, idx) => log(`${idx}) ${name}`));
    const clusterIdx = await promptly.choose('Which cluster are we checking for krot?', clusters.map((name, idx) => idx));
    cluster = clusters[clusterIdx];
  }

  const gitPath = config['git-repository'];
  let git = null;
  if (!gitPath) log('Missing git path, no git metadata will be provided!');
  else git = new GitLocal(gitPath);

  const kctl = new Kubectl(cluster);

  const deploymentData = [];

  const deployments = await kctl('get deploy --all-namespaces');

  const rows = deployments.items.reduce((memo, deployment) => {
    const containers = deployment.spec.template.spec.containers.map(({ name, image }) => ({
      namespace: deployment.metadata.namespace,
      deployment: deployment.metadata.name,
      container: name,
      image: image
    }));

    return memo.concat(containers);
  }, []);

  if (git) {
    await Promise.all(rows.map(async container => {

      const sha = container.image.replace(/.*@sha256:/gi, '');
      if (!sha) return '';

      return await git(`log --tags --simplify-by-decoration --pretty="format:%ai %d" | grep ${sha} | awk '{ print $1 }'`)
        // YYYY-MM-DD
        .then(createdAt => Object.assign(container, { createdAt }));
    }));
  }

  const table = new Table();

  const now = moment();

  let filteredRows = rows;
  if (config['ignore-unknown']) filteredRows = rows.filter(row => !!row.createdAt);

  filteredRows.forEach(({ deployment, container, image, namespace, createdAt }) => {
    table.cell('Namespace', namespace);
    table.cell('Deployment', deployment);
    table.cell('Container Name', container);
    // table.cell('Current Image', image);

    let age = 'Unknown';
    if (createdAt) age = `${now.diff(moment(createdAt, 'YYYY-MM-DD'), 'days')} days`;

    table.cell('Image age', age);
    table.newRow();
  });

  table.sort(['Namespace', 'Image age', 'Deployment']);

  console.log(table.toString());
}

debug('config used:', JSON.stringify(config, null, 2));

run(config);