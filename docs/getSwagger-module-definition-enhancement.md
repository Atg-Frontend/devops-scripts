# getSwagger Function Enhancement - Module & Definition Support

## 日期
2025-10-09

## 概述
在 `sync-swagger-file-to-private-repo.mjs` 中的 `getSwagger` 函數新增了支援使用 `module` 和 `definition` 參數來取得 Swagger 文件的功能。

## 改動位置
- **檔案**: `sync-swagger-file-to-private-repo.mjs`
- **函數**: `getSwagger` (第 299-357 行)

## 需求背景
需要支援透過 module 和 definition 參數來構建特定的 Swagger API URL，例如：
```
https://atg-services-swagger.clinicone.me/api/public/swagger?module=atg.identityserver&definition=admin_v4.6
```

## 實作細節

### 新增的判斷邏輯
當 `urlOpt` 同時包含以下 4 個 key 時，啟用新流程：
1. `module` - 模組名稱（例如：`atg.identityserver`）
2. `definition` - 定義名稱（例如：`admin_v4.6`）
3. `projectName` - 專案名稱（例如：`identity`）
4. `folderName` - 資料夾名稱（例如：`IdentityServerAdmin4.6`）

### 新流程處理方式
```javascript
if (hasModuleFlow) {
  // 構建 URL
  const baseUrl = "https://atg-services-swagger.clinicone.me/api/public/swagger";
  finalUrl = `${baseUrl}?module=${url.module}&definition=${url.definition}`;

  // 直接使用提供的專案名稱和資料夾名稱
  projectName = url.projectName;
  folderName = url.folderName;
}
```

### 原有流程保持不變
當 `urlOpt` 不包含完整的 4 個 key 時，保持原有邏輯：
- 使用 `keyRegEx` 從 URL 提取專案名稱
- 使用 `verRegEx` 從 URL 提取資料夾名稱

## 使用範例

### 新流程使用方式
```javascript
await getSwagger({
  url: "dummy-url", // 不會被使用，會被 finalUrl 取代
  urlOpt: {
    module: "atg.identityserver",
    definition: "admin_v4.6",
    projectName: "identity",
    folderName: "IdentityServerAdmin4.6"
  }
});
```

實際請求的 URL 將會是：
```
https://atg-services-swagger.clinicone.me/api/public/swagger?module=atg.identityserver&definition=admin_v4.6
```

儲存的路徑結構：
```
{project}/{folder}/swagger.json
→ identity/identityserveradmin4.6/swagger.json  (轉為小寫)
```

### 原有流程使用方式（向下相容）
```javascript
await getSwagger({
  url: "https://atg-payment-dev.clinicone.me/swagger/v1.0/swagger.json"
});

// 或

await getSwagger({
  url: "https://atg-payment-dev.clinicone.me/swagger/v1.0/swagger.json",
  urlOpt: {
    keyRegEx: "atg-(.*?)-dev",
    verRegEx: "swagger/(.*?)/swagger"
  }
});
```

## 向下相容性
✅ 完全向下相容
- 原有的 URL regex 提取方式維持不變
- 僅在提供完整的 4 個 key 時才啟用新流程
- 最小化程式碼改動

## 測試建議
1. 測試新流程：使用包含 module、definition、projectName、folderName 的 urlOpt
2. 測試原有流程：使用原有的 URL 字串或 urlOpt
3. 測試邊界情況：只提供部分 key（應回到原有流程）
4. 驗證產生的檔案路徑和內容正確性

## 注意事項
- `projectName` 和 `folderName` 會自動轉換為小寫（透過 `toLowerCase()`）
- Base URL 固定為 `https://atg-services-swagger.clinicone.me/api/public/swagger`
- 四個 key 必須同時存在才會啟用新流程
