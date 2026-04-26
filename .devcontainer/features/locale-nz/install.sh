#!/bin/bash
set -e

# refer: https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian
echo -e "\n🐙 Installing NZ Locale..."
sudo sed -i '/en_NZ.UTF-8/s/^# //' /etc/locale.gen
sudo locale-gen en_NZ.UTF-8
echo "✅ Done"

### End of File
