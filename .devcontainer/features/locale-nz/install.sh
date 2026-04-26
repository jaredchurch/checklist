#!/bin/bash
set -e

export DEBIAN_FRONTEND=noninteractive

echo -e "\n🐙 Installing NZ Locale..."
sudo sed -i '/en_NZ.UTF-8/s/^# //' /etc/locale.gen
sudo locale-gen en_NZ.UTF-8
echo "✅ Done"

### End of File
