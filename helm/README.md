# Iron Dome Simulator - Kubernetes Deployment

This directory contains Helm charts and ArgoCD configurations for deploying the Iron Dome Simulator to Kubernetes.

## Prerequisites

- Kubernetes cluster (1.24+)
- Helm 3.x
- ArgoCD (optional, for GitOps deployment)
- cert-manager (for TLS certificates)
- NGINX Ingress Controller

## Docker Image

The application is packaged as a Docker image and automatically built by GitHub Actions on:
- Push to `main` or `develop` branches
- Creating new tags (v*)

Images are pushed to GitHub Container Registry (ghcr.io).

## Helm Chart

The Helm chart is located in `helm/iron-dome-simulator/` and includes:
- Deployment with configurable replicas
- Service (ClusterIP by default)
- Ingress (optional)
- HPA (optional)
- Security contexts and resource limits

### Installing with Helm

```bash
# Development environment
helm install iron-dome-dev ./iron-dome-simulator \
  -f iron-dome-simulator/values-dev.yaml \
  -n iron-dome-dev --create-namespace

# Production environment
helm install iron-dome-prod ./iron-dome-simulator \
  -f iron-dome-simulator/values-prod.yaml \
  -n iron-dome-prod --create-namespace
```

### Upgrading

```bash
helm upgrade iron-dome-dev ./iron-dome-simulator \
  -f iron-dome-simulator/values-dev.yaml \
  -n iron-dome-dev
```

## ArgoCD Deployment

ArgoCD application manifests are in the `argocd/` directory.

### Setup

1. Install ArgoCD applications:
```bash
kubectl apply -f ../argocd/application-dev.yaml
kubectl apply -f ../argocd/application-prod.yaml
```

2. Update the repository URL in the application manifests to match your repository.

### GitOps Workflow

- **Development**: Automatically syncs from `develop` branch
- **Production**: Manual sync from `main` branch or specific tags

## Configuration

### Environment Variables

Configure through Helm values:
```yaml
env:
  - name: EXAMPLE_VAR
    value: "example-value"
```

### Ingress

The chart supports Kubernetes Ingress with:
- Traefik ingress controller
- TLS termination via cert-manager
- Automatic certificate generation

Default hostnames:
- `values-dev.yaml`: iron-dome-dev.example.com (staging cert)
- `values-prod.yaml`: iron-dome.example.com (production cert)

### Resources

Default resource limits:
- **Dev**: 100m CPU, 128Mi memory
- **Prod**: 500m CPU, 512Mi memory

### Autoscaling

Production uses HPA with:
- Min replicas: 3
- Max replicas: 10
- Target CPU: 70%
- Target Memory: 80%

## Security

- Non-root container (nginx user)
- Read-only root filesystem
- No privilege escalation
- Minimal capabilities

## Monitoring

The application exposes health checks:
- Liveness: `/` (HTTP GET)
- Readiness: `/` (HTTP GET)

## Troubleshooting

### Check deployment status
```bash
kubectl get pods -n iron-dome-dev
kubectl describe pod <pod-name> -n iron-dome-dev
kubectl logs <pod-name> -n iron-dome-dev
```

### Verify Ingress
```bash
kubectl get ingress -n iron-dome-dev
kubectl describe ingress iron-dome-simulator -n iron-dome-dev
```

### ArgoCD sync issues
```bash
argocd app get iron-dome-simulator-dev
argocd app sync iron-dome-simulator-dev
```

## CI/CD Pipeline

The GitHub Actions workflow:
1. Builds multi-platform Docker images (amd64, arm64)
2. Tags images with:
   - Branch name
   - Git SHA
   - Semantic version (for tags)
3. Pushes to GitHub Container Registry
4. Updates Helm chart version (for tags)

## Updates

To deploy a new version:
1. Tag the release: `git tag v1.0.1 && git push --tags`
2. Wait for CI/CD to build and push the image
3. Update the image tag in Helm values or let ArgoCD sync automatically