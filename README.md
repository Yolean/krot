# krot (kubernetes-rot)
We're running the same service (Docker image) over a lot of different deployments for different customers. The motivation behind it is configurability, experimentation and synchronizing/timing upgrades with the customer.

To prevent services lagging behind (i.e. its code rotting) when this shouldn't be the case we need some visibility on which images the different deployments are running.

Introducing `krot`.

This project relies on a few assumptions:

* We have a monolithic git repository
* We use git tags to keep track of the origin of our Docker image SHAs
* We try to always run explicit SHA images for our deployments

A deployment not running the latest image for that service could be seen as rot, and we should either take action or have a good excuse for this.

## Usage

```sh

git clone git@github.com/Yolean/krot
cd krot && npm install -g

echo "git-repository=/path/to/mono-repo" >> ~/.krotrc

# Assuming you're using separate kube config files for different kubernetes clusters
# Like: https://github.com/atamon/kube-cluster-alias tries to enforce
KUBECONFIG=/home/user/.kube/prod-config krot
```
