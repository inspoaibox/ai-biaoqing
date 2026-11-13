// 复制为 ecosystem.config.cjs 后，再填写生产环境值。
// ecosystem.config.cjs 已加入 .gitignore，里面可以保存服务器密钥。
module.exports = {
  apps: [
    {
      name: 'ai-biaoqing-api',
      script: 'server.mjs',
      cwd: '/var/www/ai-biaoqing',
      env: {
        NODE_ENV: 'production',
        STICKER_ADMIN_EMAIL: 'admin@example.com',
        STICKER_ADMIN_PASSWORD: '请替换为至少 12 位的随机密码',
        STICKER_DB_PATH: './data/sticker.sqlite',
        STICKER_WEB_ORIGIN: 'https://sticker.example.com',
        STICKER_SECURE_COOKIE: '1',
        STICKER_PYTHON_BIN: 'python3',
      },
    },
  ],
}
