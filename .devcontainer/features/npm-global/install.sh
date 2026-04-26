#!/bin/bash
set -e

PACKAGES="${PACKAGES:-}"

if [ -z "$PACKAGES" ]; then
    echo "No packages specified. Skipping npm global install."
    exit 0
fi

echo "Installing npm packages globally: $PACKAGES"
npm install -g $PACKAGES
echo "Done."