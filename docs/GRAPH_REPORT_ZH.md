# 圖譜報告 - . (2026-04-16)

## 語料庫檢查 (Corpus Check)
- 15 個檔案 · 約 8,712 字
- **評估**：語料庫規模足夠，建立圖譜結構可提供有效價值的專案洞察。

## 摘要 (Summary)
- 偵測到 **110 個節點** · **138 條邊 (Edges)** · **15 個社區 (Communities)**
- 提取狀態：100% 已提取 (EXTRACTED) · 0% 推論 (INFERRED) · 0% 模糊 (AMBIGUOUS)
- Token 消耗：0 input · 0 output

## 神級節點 (God Nodes - 專案的核心抽象層)
1. `loadConfig()` - 6 條關連
2. `g()` - 5 條關連
3. `getNthColumn()` - 5 條關連
4. `enableUI()` - 5 條關連
5. `sendTelegramNotification()` - 4 條關連
6. `sendDiscordNotification()` - 4 條關連
7. `sendNotification()` - 4 條關連
8. `testNotification()` - 4 條關連
9. `makeCurrent()` - 4 條關連
10. `Q()` - 4 條關連

## 意外的關連 (Surprising Connections)
- **無**：目前偵測到的所有關連皆位於相同的源代碼檔案內。

## 社區結構 (Communities)

### 社區 0 - 黑名單管理
- **凝聚度**：0.19
- **節點 (5)**：addToBlacklist(), autoBlacklistCheck(), recordViolation(), removeFromBlacklist(), saveBlacklist()

### 社區 1 - UI 表格處理
- **凝聚度**：0.27
- **節點 (11)**：addSortIndicators(), enableUI(), getNthColumn(), getTable(), getTableBody(), getTableHeader(), loadColumns(), loadData() (+3 more)

### 社區 2 - 代碼混淆/工具函數
- **凝聚度**：0.35
- **節點 (8)**：a(), B(), D(), g(), i(), k(), Q(), y()

### 社區 3 - 通知系統
- **凝聚度**：0.44
- **節點 (7)**：formatDiscordEmbed(), formatTelegramMessage(), runCustomScript(), sendDiscordNotification(), sendNotification(), sendTelegramNotification(), testNotification()

### 社區 5 - 廣播服務 (Websocket/Alerts)
- **凝聚度**：0.28
- **節點 (3)**：broadcast(), broadcastAlert(), broadcastRequest()

### 社區 7 - 配置載入與監控
- **凝聚度**：0.36
- **節點 (6)**：getAllConfig(), getConfig(), loadConfig(), parseEnvFile(), reloadConfig(), watchConfig()

### 社區 11 - 導覽切換 (Next/Previous)
- **凝聚度**：0.7
- **節點 (4)**：goToNext(), goToPrevious(), makeCurrent(), toggleClass()

## 知識斷層 (Knowledge Gaps)
- **稀疏社區 Community 12** (1 個節點)：`server.test.js`
  - 規模太小，無法形成有意義的集群。可能是雜訊或需要提取更多關連。
- **稀疏社區 Community 13** (1 個節點)：`config.js`
  - 規模太小。
- **稀疏社區 Community 14** (1 個節點)：`setup_git_sync.ps1`
  - 規模太小。

## 建議提問 (Suggested Questions)
*目前信號不足，無法自動生成建議問題。這通常意味著語料庫中沒有模糊的邊、橋接節點或推論關係，且所有社區都非常緊密。您可以嘗試加入更多檔案或使用 `--mode deep` 執行以提取更豐富的關連。*
