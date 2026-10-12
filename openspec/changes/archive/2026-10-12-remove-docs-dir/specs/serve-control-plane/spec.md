# serve-control-plane 规格变更

## ADDED Requirements

### Requirement: 独立 Console 的部署与浏览器恢复

**Identifier:** SCTRL-OPS-001

Console SHALL 是同机独立 HTTPS 进程，仅连接 Core loopback API；浏览器可远端访问，停止 Console 不停止 Core 或已接受 Operation。public-origin 必须匹配实际 HTTPS origin 和监听端口，证书覆盖主机，私钥只允许 owner 读取。默认 Core 127.0.0.1:7171、监听 0.0.0.0:7173，数据目录 .piwork/console。Core 不可达仍显示登录页及真实可用性，不提供 bootstrap。

仅管理员 SHALL 能登录，普通用户由 CLI 管理自己的 Work。浏览器只持 Secure/HttpOnly/SameSite=Strict 会话 Cookie，Core bearer 在 Console 内存，重启重新登录。Overview/User access/Work setup/AI models 与辅助 Find operation 保持当前导航和深链接，未知写入先读回，默认配置只影响后续 Work。

界面资源 SHALL 嵌入 Go 程序；修改 UI 后构建对应 WebUI、重新构建并重启 Console，单纯刷新不能装入新构建。Package Operation 只按已知 ID 恢复，不伪造全局历史；观察中断不取消或新键重提，Work scope ID 不作为管理 Operation 展示。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```bash
make build-go
./dist/go/piwork-console serve \
  --core http://127.0.0.1:7171 \
  --listen 0.0.0.0:7173 \
  --public-origin https://console.example.com:7173 \
  --tls-cert /etc/piwork/console-cert.pem \
  --tls-key /etc/piwork/console-key.pem \
  --data-dir "$PWD/.piwork/console"
```

```bash
mkdir -p .piwork/console-preview
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -keyout .piwork/console-preview/key.pem \
  -out .piwork/console-preview/cert.pem \
  -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1'
chmod 600 .piwork/console-preview/key.pem
PIWORK_PREVIEW_CERT="$PWD/.piwork/console-preview/cert.pem"
PIWORK_PREVIEW_KEY="$PWD/.piwork/console-preview/key.pem"
make build-go
./dist/go/piwork-console serve \
  --core http://127.0.0.1:7171 \
  --listen 127.0.0.1:7173 \
  --public-origin https://127.0.0.1:7173 \
  --tls-cert "$PIWORK_PREVIEW_CERT" \
  --tls-key "$PIWORK_PREVIEW_KEY" \
  --data-dir "$PWD/.piwork/console-preview/data"
```
