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

function Kubectl() {

  return (cmd) => {
    const command = `kubectl ${cmd} -o json`;
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

function parseGitTagLog(output, sha) {
  if (!output) return {};

  const regex = /(^[0-9]*)\s{2}(.*)/;

  const match = regex.exec(output);
  if (!match) throw new Error('Failed to match output: ' + output);

  const [_, timestamp, tags] = match;
  const imageCreated = (+timestamp.trim()) * 1000;

  let tag = '';
  tags.replace(/tag:\s([^,)]+)/gi, (match, p1, offset, string) => {

    if (match.indexOf(sha) !== -1) tag = p1;

    return '';
  });

  return { imageCreated, tag };
}

async function run(config) {

  const gitPath = config['git-repository'];
  let git = null;
  if (!gitPath) log('Missing git path, no git metadata will be provided!');
  else git = new GitLocal(gitPath);

  const kctl = new Kubectl();

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
      if (!sha) return;

      const output = await git(`log --tags --simplify-by-decoration --pretty="format:%at %d" | grep ${sha}`);
      if (!output) return;

      const { imageCreated, tag } = parseGitTagLog(output, sha);

      const imagePrefix = tag.replace(sha, '');
      const outputNewest = await git(`log --tags --simplify-by-decoration --pretty="format:%at %d" | grep ${imagePrefix} | head -n 1`);
      if (!outputNewest) return;

      const parsedNewest = parseGitTagLog(outputNewest, imagePrefix);

      Object.assign(container, { imageCreated, newestImageCreated: parsedNewest.imageCreated });

      return Promise.resolve();
    }));
  }

  const table = new Table();

  const now = moment();

  let filteredRows = rows;
  if (config['ignore-unknown']) filteredRows = rows.filter(row => !!row.imageCreated);

  filteredRows.forEach(({ deployment, container, image, namespace, imageCreated, newestImageCreated }) => {
    table.cell('Namespace', namespace);
    table.cell('Deployment', deployment);
    table.cell('Container Name', container);
    // table.cell('Current Image', image);

    let age = '';
    const mImageCreated = moment(imageCreated);
    if (imageCreated) age = `${now.diff(mImageCreated, 'days')} days`;

    let rot = '';
    if (newestImageCreated) rot = `${moment(newestImageCreated).diff(mImageCreated, 'days')} days`;

    table.cell('Image created', mImageCreated.format('YYYY-MM-DD'));
    table.cell('Image rot', rot);
    table.newRow();
  });

  table.sort(['Namespace', 'Image rot', 'Image age', 'Deployment']);

  console.log(table.toString());
}

debug('config used:', JSON.stringify(config, null, 2));

run(config);