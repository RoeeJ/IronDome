#!/bin/bash
set -e

echo "🐳 Testing Docker build locally..."

# Build the Docker image
echo "Building Docker image..."
docker build -t iron-dome-simulator:test .

# Run the container
echo "Running container..."
docker run -d --name iron-dome-test -p 8080:80 iron-dome-simulator:test

echo "✅ Container running at http://localhost:8080"
echo "   Run 'docker logs iron-dome-test' to see logs"
echo "   Run 'docker stop iron-dome-test && docker rm iron-dome-test' to cleanup"