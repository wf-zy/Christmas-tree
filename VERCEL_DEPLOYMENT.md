# Vercel 部署指南

## 📌 重要说明

**Vercel 是云部署平台，不需要你自己的服务器！**

- ✅ 项目会部署到 Vercel 的云服务器
- ✅ 自动提供 HTTPS 证书
- ✅ 自动配置全球 CDN
- ✅ 免费版完全够用
- ✅ 国内可以正常访问

## 🚀 部署方法

### 方法 1: 通过 Vercel 网站（推荐，最简单）

#### 步骤 1: 准备代码仓库

1. **将代码推送到 GitHub/GitLab/Bitbucket**
   ```bash
   # 如果还没有 Git 仓库
   git init
   git add .
   git commit -m "Initial commit"
   
   # 在 GitHub 创建新仓库，然后推送
   git remote add origin https://github.com/你的用户名/christmas-tree.git
   git push -u origin main
   ```

#### 步骤 2: 在 Vercel 部署

1. **访问 Vercel 网站**
   - 打开：https://vercel.com/
   - 点击 "Sign Up" 注册（可以用 GitHub 账号登录）

2. **导入项目**
   - 登录后点击 "Add New..." → "Project"
   - 选择你的 GitHub 仓库（christmas-tree）
   - 点击 "Import"

3. **配置项目**
   - **Framework Preset**: Vite（会自动检测）
   - **Root Directory**: `./`（默认）
   - **Build Command**: `npm run build`（默认）
   - **Output Directory**: `dist`（默认）
   - **Install Command**: `npm install`（默认）

4. **环境变量**（通常不需要，除非有特殊配置）

5. **点击 "Deploy"**
   - Vercel 会自动构建和部署
   - 等待 1-2 分钟

6. **获得访问地址**
   - 部署完成后会显示类似：`https://christmas-tree-xxx.vercel.app`
   - 这个地址就可以直接访问了！

### 方法 2: 通过 Vercel CLI（命令行）

#### 步骤 1: 安装 Vercel CLI

```bash
npm i -g vercel
```

#### 步骤 2: 登录 Vercel

```bash
vercel login
```

#### 步骤 3: 部署

```bash
# 在项目目录下运行
vercel

# 首次部署会询问一些问题：
# - Set up and deploy? Y
# - Which scope? 选择你的账号
# - Link to existing project? N
# - Project name? christmas-tree（或自定义）
# - Directory? ./
# - Override settings? N
```

#### 步骤 4: 生产环境部署

```bash
# 部署到生产环境
vercel --prod
```

## ⚙️ 项目配置

### 已创建的配置文件

项目已包含 `vercel.json` 配置文件，包含：
- ✅ 构建命令
- ✅ 输出目录
- ✅ SPA 路由重写规则（支持 React Router）

### 确保 MediaPipe 资源已本地化

**重要！** 确保 `public/mediapipe/` 目录下有：
- `wasm/` 文件夹（包含 WASM 文件）
- `gesture_recognizer.task` 模型文件

这些文件会自动包含在部署中。

## 🔄 自动部署

### 连接 GitHub 后自动部署

1. **每次推送代码自动部署**
   - 推送到 `main` 分支 → 自动部署到生产环境
   - 推送到其他分支 → 自动创建预览部署

2. **查看部署历史**
   - 在 Vercel Dashboard 可以看到所有部署
   - 每个部署都有独立的 URL

## 🌐 自定义域名（可选）

### 添加自定义域名

1. **在 Vercel Dashboard**
   - 进入项目设置
   - 点击 "Domains"
   - 添加你的域名（例如：`christmas.yourdomain.com`）

2. **配置 DNS**
   - 按照 Vercel 的提示配置 DNS 记录
   - 通常是添加 CNAME 记录

3. **自动 HTTPS**
   - Vercel 会自动为自定义域名配置 HTTPS
   - 无需手动配置证书

## 📝 部署检查清单

部署前确认：

- [ ] 代码已推送到 Git 仓库
- [ ] `public/mediapipe/` 目录存在且包含资源文件
- [ ] `vercel.json` 配置文件存在
- [ ] `package.json` 中有 `build` 脚本
- [ ] 本地测试 `npm run build` 成功

## 🐛 常见问题

### 问题 1: 构建失败

**检查**：
- 确保所有依赖都已安装
- 检查 `package.json` 中的脚本是否正确
- 查看 Vercel 构建日志

### 问题 2: 页面空白

**可能原因**：
- MediaPipe 资源未正确上传
- 检查 `public/mediapipe/` 是否在 Git 仓库中

**解决**：
```bash
# 确保文件已提交
git add public/mediapipe/
git commit -m "Add MediaPipe resources"
git push
```

### 问题 3: 路由 404

**解决**：
- `vercel.json` 中已配置 SPA 路由重写
- 如果还有问题，检查配置是否正确

### 问题 4: 摄像头无法使用

**检查**：
- 确保使用 HTTPS（Vercel 自动提供）
- 检查浏览器控制台错误
- 确认 MediaPipe 资源已正确加载

## 🎯 部署后的操作

### 1. 测试访问

访问 Vercel 提供的 URL，测试：
- ✅ 页面正常加载
- ✅ 3D 场景正常显示
- ✅ 摄像头权限请求正常
- ✅ 手势识别功能正常

### 2. 分享链接

将 Vercel URL 分享给其他人即可访问！

### 3. 监控和日志

- 在 Vercel Dashboard 查看访问统计
- 查看函数日志（如果有）
- 监控错误和性能

## 💡 优势

使用 Vercel 部署的优势：

1. **完全免费**（个人项目）
2. **自动 HTTPS**（摄像头功能必需）
3. **全球 CDN**（访问速度快）
4. **自动部署**（Git 推送即部署）
5. **国内可访问**（比 Cloudflare Tunnel 稳定）
6. **无需服务器**（零运维成本）

## 🔄 更新部署

每次更新代码：

```bash
# 1. 修改代码
# 2. 提交更改
git add .
git commit -m "Update code"
git push

# 3. Vercel 自动部署（如果已连接 GitHub）
# 或手动部署
vercel --prod
```

## 📚 相关文档

- Vercel 官方文档：https://vercel.com/docs
- Vite 部署指南：https://vitejs.dev/guide/static-deploy.html#vercel

