# Chef and Jenkins (optional CI/CD and config management)

Optional components you can add to the stack for config management (Chef) and CI/CD (Jenkins).

## Jenkins

- **Kubernetes:** Run Jenkins in-cluster (e.g. Helm chart `jenkinsci/jenkins` or official Helm chart).
- **Ansible:** A playbook can deploy Jenkins via Helm and set default plugins and jobs.

Example (add to a playbook or run manually):

```bash
helm repo add jenkinsci https://charts.jenkins.io
helm repo update
kubectl create namespace jenkins --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install jenkins jenkinsci/jenkins \
  --namespace jenkins \
  --set controller.ingress.enabled=true \
  --set controller.ingress.hostName=jenkins.off-campus-housing.test
```

Then configure Jenkins to build/test the off-campus-housing-tracker services and run the preflight script on a schedule or on push.

## Chef

- **Use case:** Config management for VMs or bare metal that run outside Kubernetes (e.g. DB hosts, bastions).
- **Ansible:** Ansible can bootstrap Chef (install chef-client, register with a Chef server or use Chef Solo/Zero).
- **Colima/K3s:** For local dev we use K8s and Ansible; Chef is optional for non-containerized nodes.

To add Chef via Ansible:

1. Add a role that installs `chef-workstation` or `chef-client` and applies cookbooks.
2. Point it at a Chef server or use `chef-solo` / `chef-zero` with local cookbooks.

Example role tasks (sketch):

```yaml
- name: Install Chef client (optional)
  block:
    - name: Add Chef repo
      apt_repository: ...
    - name: Install chef
      apt: name=chef state=present
  when: use_chef | default(false) | bool
```

## Recommendation

- **Jenkins:** Add when you want a dedicated CI server in-cluster; otherwise keep using GitHub Actions (or current CI).
- **Chef:** Add when you have non-Kubernetes nodes to manage with Chef cookbooks; otherwise Ansible + Kustomize is enough for this repo.
