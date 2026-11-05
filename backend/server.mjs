import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 3000);
const server = createApp();
server.on('error', (error) => { console.error('本地服务启动失败：', error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`润网本地预览：http://127.0.0.1:${server.address().port}`));
