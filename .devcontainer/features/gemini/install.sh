#!/bin/bash
set -e

# refer: https://github.com/github/spec-kit

# export DEBIAN_FRONTEND=noninteractive

if [ ! -x "$(command -v node)" ] || [ ! -x "$(command -v npm)" ]; then
  echo "Node.js and npm are not installed. Installing them first..."
  DEBIAN_FRONTEND=noninteractive apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install nodejs npm -y
fi

npm install -g @google/gemini-cli
echo "✅ Install Gemini"

### End of File
