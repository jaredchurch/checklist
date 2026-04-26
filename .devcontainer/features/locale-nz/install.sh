#!/bin/bash
set -e

export DEBIAN_FRONTEND=noninteractive

sudo sed -i '/en_NZ.UTF-8/s/^# //' /etc/locale.gen
sudo locale-gen en_NZ.UTF-8
echo "✅ NZ Locale Install Done"

### End of File
