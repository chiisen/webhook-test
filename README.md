# Grafana Webhook Debugger

這是一個輕量級的 Webhook 監聽伺服器，專門用於除錯 Grafana Alerting 通知問題。

## 🎯 專案目的

本專案的建立是因為在使用 Grafana 設定 Contact Points (Telegram) 時遇到訊息無法送達且無錯誤訊息的狀況。為了排查問題，我們建立這個 Webhook Server 來直接攔截並顯示 Grafana 發出的 Alert Payload。

透過這個工具，你可以：

1. 確認 Grafana 是否真的有發出 Alert。
2. 檢視 Grafana 發出的完整 JSON 資料結構。
3. 驗證 label 與 annotation 的內容是否符合預期。

## 🚀 功能特色

- **彩色日誌**：使用 ANSI 顏色碼區分 HTTP 方法、URL、時間戳記與內容，提升閱讀性。
- **結構化輸出**：自動將接收到的 JSON Body 格式化並展開，方便閱讀巢狀結構。
- **錯誤處理**：包含基礎的錯誤捕捉，避免因為格式錯誤導致伺服器崩潰。
- **彈性配置**：支援透過環境變數調整各種設定。
- **Request ID 追蹤**：每個請求配有唯一 ID，方便除錯關聯。
- **API Token 驗證**：支援 Header 驗證，防止未授權訪問。
- **Rate Limiting**：每分鐘請求次數限制，防止濫用。
- **IP 白名單**：可限制訪問來源 IP。
- **Payload 驗證**：驗證 Grafana webhook 必要欄位。
- **CORS 支援**：允許跨域請求。
- **請求體大小限制**：防止大檔案攻擊。
- **請求統計**：提供 `/stats` 端點查看流量統計。
- **Graceful Shutdown**：優雅關閉伺服器。
- **單元測試**：完整的 Jest 測試覆蓋。

## 🛠️ 安裝與執行

### 前置需求

- Node.js (建議 v18+)

### 1. 安裝依賴

```bash
npm install express
```

### 2. 啟動伺服器

```bash
# 預設監聽 9999 port
node server.js

# 或者指定其他 port
PORT=3000 node server.js
```

### 3. VS Code 除錯

本專案已包含 `.vscode/launch.json`，您可以直接在 VS Code 中按下 `F5` 啟動除錯模式。

### 4. Docker 執行（可選）

```bash
# 構建映像檔
docker build -t webhook-server .

# 執行容器
docker run -d -p 9999:9999 --name webhook-server \
  -e PORT=9999 \
  -e API_TOKEN=your-secret-token \
  -e RATE_LIMIT=60 \
  -e ALERT_SOUND=Glass \
  webhook-server
```

## ⚙️ 環境變數設定 (.env)

本專案支援透過 `.env` 檔案進行詳細設定。請複製 `.env.example`（若無則直接建立 `.env`）並依需求修改：

```env
# 伺服器監聽埠口 (預設: 9999)
PORT=9999

# API Token 驗證 (可選)
# 在請求時須加上 Header: X-API-TOKEN
API_TOKEN=your-secret-token

# Rate Limit (每分鐘最多請求次數，預設: 60)
# RATE_LIMIT=60

# Request Body 大小限制 (預設: 1mb)
# BODY_LIMIT=1mb

# SQLite 資料庫路徑 (預設: ./webhook-history.db)
DB_PATH=./webhook-history.db

# 歷史記錄保留天數 (預設: 30)
HISTORY_DAYS=30

# 歷史記錄最大大小 MB (預設: 100)
HISTORY_MAX_SIZE_MB=100

# IP 白名單 (逗號分隔，留空允許所有，* 代表任意)
# ALLOWED_IPS=127.0.0.1,::1

# 警報音效設定 (僅 macOS 有效)
# 預設: Glass
ALERT_SOUND=Glass

# 音量設定
# 範圍: 0.0 ~ 1.0 (正常音量), >1.0 (放大)
# 預設: 0.5
ALERT_VOLUME=0.5
```

### 🔐 API Token 驗證

若設定了 `API_TOKEN`，請求 `/test` 端點時須在 Header 加入 Token：

```bash
curl -X POST http://localhost:9999/test \
  -H "X-API-TOKEN: your-secret-token" \
  -d '{}'
```

未提供正確 Token 時會收到 `401 Unauthorized`。

### 🎵 可用音效列表 (macOS)

您可以將 `ALERT_SOUND` 設定為以下任一值：

- `Glass` (預設，清脆玻璃聲)
- `Bottle` (類似吹瓶口的聲音)
- `Funk` (短促的 Funk 音效)
- `Hero` (響亮的號角聲)
- `Morse` (摩斯密碼聲)
- `Ping` (金屬聲)
- `Pop` (氣泡聲)
- `Purr` (呼嚕聲)
- `Sosumi` (Sosumi 音效)
- `Submarine` (潛水艇聲納)
- `Tink` (清脆叮聲)

> ⚠️ **注意**：修改 `.env` 檔案後，必須**重新啟動伺服器** (或重新開始除錯) 才會生效。

## 📡 API 端點

| 端點              | 方法 | 說明                                |
| ----------------- | ---- | ----------------------------------- |
| `/health`         | GET  | 服務健康檢查                        |
| `/stats`          | GET  | 請求統計資訊                        |
| `/test`           | POST | Grafana Webhook 接收端點            |
| `/history`        | GET  | 請求歷史記錄 (SQLite)               |
| `/history/search` | GET  | 搜尋歷史記錄 (支援 status, ip, url) |
| `/history/stats`  | GET  | 歷史記錄統計 (總數, firing 數量)    |

### /test 請求範例

```bash
curl -X POST http://localhost:9999/test \
  -H "Content-Type: application/json" \
  -H "X-API-TOKEN: your-secret-token" \
  -d '{
    "status": "firing",
    "alerts": [
      {
        "title": "High CPU Usage",
        "state": "firing"
      }
    ]
  }'
```

## ⚙️ Grafana 設定範例

在 Grafana 的 **Contact Points** 設定中：

1. **Integration**: 選擇 `Webhook`
2. **URL**: 輸入本機伺服器位址
   - 若 Grafana 運行於 Docker 中，請使用：`http://host.docker.internal:9999/test`
   - 若直接運行，請使用：`http://localhost:9999/test`
3. **HTTP Method**: POST
4. 點擊 **Test** 按鈕發送測試通知，你應該會在終端機看到彩色的 Payload 輸出。

## 🧪 測試

```bash
# 執行單元測試
npm test
```

---

## 📋 待辦事項 (Todo List)

### 1. 🔔 通知增強

- [ ] 多管道通知：加入 Telegram/Discord/Slack 通知支援
- [ ] 自定義腳本觸發：收到 firing alert 時執行自定義腳本

### 2. 📝 日誌管理

- [ ] 日誌輪轉：使用 `winston` 或 `pino` 實現日誌檔案輪轉
- [ ] 結構化日誌：改為 JSON 格式輸出，方便日後分析
- [ ] 請求日誌：獨立記錄請求到日誌檔案（目前只在控制台輸出）

### 3. 💾 歷史記錄優化

- [x] 自動清理：自動刪除 N 天前的歷史記錄
- [x] 大小限制：限制歷史檔案最大 size
- [x] 資料庫儲存：改用 SQLite 方便查詢與篩選

### 4. 🛡️ 安全強化

- [ ] 請求驗證 `X-Cortex-Signature` header：支援 Grafana 驗證
- [ ] 黑名單機制：被 block 的 IP 加入黑名單

### 5. 🔄 流量管理

- [ ] Redis Rate Limit：重啟不丟失計數
- [ ] Webhook 轉發：可將請求轉發到其他 endpoint

### 6. ⚡ 功能擴展

- [ ] 熱重載配置：修改 `.env` 無需重啟伺服器
- [ ] Replay 功能：重新發送歷史請求
- [ ] WebSocket：即時推送 alerts 到前端 UI
