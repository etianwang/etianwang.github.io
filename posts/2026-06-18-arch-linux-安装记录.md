---
title: Arch Linux 安装记录
date: 2026-06-18
category: Linux
tags: Arch,折腾记录
---

# Arch Linux 安装攻略（VMware + UEFI + Btrfs）

> 环境：VMware Workstation，UEFI 固件，桥接网络，Btrfs 文件系统

---

## 一、VMware 配置

- 固件类型：**UEFI**（关闭安全引导）
- 网络：**桥接模式**，手动指定宿主机网卡，不选"自动"
- 磁盘：建议 ≥ 20GB
- 内存：建议 ≥ 2GB
- 3D 加速：**不开启**（装完桌面环境后按需开启）
- 侧通道缓解：个人学习可关闭，提升性能

---

## 二、启动 Live 环境

1. 挂载 Arch ISO 到虚拟光驱
2. 启动后选择：`Arch Linux install medium (x86_64, UEFI)`
3. 进入后提示符为 `root@archiso ~ #`

---

## 三、验证 UEFI 模式

```bash
ls /sys/firmware/efi
```

目录存在 = UEFI 模式，不存在 = BIOS 模式。

---

## 四、网络配置

```bash
# 查看网卡名称（一般为 ens33）
ip link

# 自动获取 IP
dhcpcd ens33

# 验证网络
ping -c 3 archlinux.org

# 同步系统时间
timedatectl set-ntp true
```

---

## 五、分区

本方案分三个区：

| 分区 | 大小 | 类型 | 格式 |
|------|------|------|------|
| sda1 | 512MB | EFI System | FAT32 |
| sda2 | 4GB | Linux swap | swap |
| sda3 | 剩余全部 | Linux filesystem | Btrfs |

```bash
fdisk /dev/sda
```

fdisk 内操作：

```
g        # 创建 GPT 分区表

n → 1 → 回车 → +512M    # EFI 分区
n → 2 → 回车 → +4G      # swap 分区
n → 3 → 回车 → 回车     # 根分区

t → 1 → 1     # sda1 类型设为 EFI System
t → 2 → 19    # sda2 类型设为 Linux swap
t → 3 → 20    # sda3 类型设为 Linux filesystem

w            # 写入并退出
```

---

## 六、格式化

```bash
mkfs.fat -F32 /dev/sda1    # ESP 格式化为 FAT32
mkswap /dev/sda2            # 初始化 swap
mkfs.btrfs /dev/sda3        # 根分区格式化为 Btrfs
```

---

## 七、挂载（Btrfs 子卷）

```bash
# 临时挂载，创建子卷
mount /dev/sda3 /mnt
btrfs subvolume create /mnt/@
btrfs subvolume create /mnt/@home
umount /mnt

# 按子卷重新挂载
mount -o subvol=@,compress=zstd /dev/sda3 /mnt
mkdir -p /mnt/home
mount -o subvol=@home,compress=zstd /dev/sda3 /mnt/home

# 挂载 ESP 和启用 swap
mkdir -p /mnt/boot/efi
mount /dev/sda1 /mnt/boot/efi
swapon /dev/sda2
```

验证挂载：

```bash
lsblk
```

---

## 八、安装基本系统

```bash
pacstrap -K /mnt base linux linux-firmware btrfs-progs \
  networkmanager vim nano intel-ucode \
  grub efibootmgr cups bluez bluez-utils \
  sudo noto-fonts-cjk
```

> AMD CPU 把 `intel-ucode` 换成 `amd-ucode`

---

## 九、生成 fstab

```bash
genfstab -U /mnt >> /mnt/etc/fstab
cat /mnt/etc/fstab    # 验证内容
```

---

## 十、进入新系统

```bash
arch-chroot /mnt
```

---

## 十一、系统基础配置

```bash
# 时区（以阿比让为例）
ln -sf /usr/share/zoneinfo/Africa/Abidjan /etc/localtime
hwclock --systohc

# 语言
echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen
echo "zh_CN.UTF-8 UTF-8" >> /etc/locale.gen
locale-gen
echo "LANG=en_US.UTF-8" > /etc/locale.conf

# 主机名
echo "archlinux" > /etc/hostname

# root 密码
passwd
```

---

## 十二、安装引导器 GRUB

```bash
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=ARCH
grub-mkconfig -o /boot/grub/grub.cfg
```

---

## 十三、启用服务

```bash
systemctl enable NetworkManager
systemctl enable cups
systemctl enable bluetooth
```

---

## 十四、创建普通用户

```bash
useradd -m -G wheel -s /bin/bash 用户名
passwd 用户名
```

配置 sudo：

```bash
EDITOR=nano visudo
```

找到下面这行，去掉 `#`：

```
# %wheel ALL=(ALL:ALL) ALL
```

改为：

```
%wheel ALL=(ALL:ALL) ALL
```

---

## 十五、安装 VMware Tools

```bash
pacman -S open-vm-tools
systemctl enable --now vmtoolsd
systemctl enable --now vmware-vmblock-fuse
```

---

## 十六、退出并重启

```bash
exit      # 退出 chroot
reboot    # 重启
```

> 重启前在 VMware 中卸载 ISO，防止再次从光盘启动。

---

## 常见问题

### PGP 签名验证失败

```bash
sudo pacman -Sy archlinux-keyring
```

### 更换镜像源

```bash
sudo reflector --country France --age 12 --protocol https --sort rate --save /etc/pacman.d/mirrorlist
sudo pacman -Sy
```

### 终端显示异常

```bash
reset
```

---

## 分区概念速查

| 概念 | 说明 |
|------|------|
| BIOS | 传统固件，配合 MBR |
| UEFI | 现代固件，配合 GPT，支持 Secure Boot |
| MBR | 磁盘前 512 字节，最多 4 个主分区，最大 2TB |
| GPT | 现代分区表，最多 128 个分区，支持 18EB |
| ESP | EFI 系统分区，FAT32，存放 .efi 引导文件 |
| Btrfs | 支持快照、压缩、子卷的现代文件系统 |
| ext4 | 成熟稳定的传统 Linux 文件系统 |
| swap | 交换分区，内存不足时作为虚拟内存使用 |

