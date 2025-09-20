# VitSense Webアプリ仕様書

このドキュメントは，Web Bluetooth を用いて **MAX30102（心拍センサ）** と **MLX90632（赤外線温度センサ）** を接続・計測するアプリケーションの仕様とデータフローをまとめたものです．

---

## 1. 全体概要
- ブラウザ上で動作する Webアプリ
- **MAX30102**（右耳／左耳），**MLX90632**（右耳／左耳）の計4台をサポート
- データをリアルタイム表示（数値＋グラフ）し，Excel（.xlsx）でダウンロード可能

---

## 2. 機能仕様

### 接続
- ユーザは「接続」ボタンから各デバイスを選択してペアリング
- 接続完了するとデバイス名と状態が表示される
- デバイスが切断された場合は自動で未接続状態に戻り，計測中なら計測も停止する

### 計測開始・停止
- 4台すべて接続された時点で「計測開始」ボタンが有効化
- 押下で計測開始 → 各センサからのデータを受信し，グラフと数値を更新
- 再度押下で計測停止 → 受信処理を止める

### 表示内容
- **MAX30102（心拍センサ）**
  - 心拍数（BPM）
  - 移動平均BPM（直近4サンプル）
  - 経過時間（計測開始からの秒数）
  - データを受信した時刻（JST）
  - 装着状態（距離フラグ：正常／離れている）

- **MLX90632（温度センサ）**
  - 周囲温度（Ambient）
  - 対象物温度（Object）
  - 経過時間（計測開始からの秒数）
  - データを受信した時刻（JST）

### グラフ表示
- **MAX**：心拍数（BPM）の右／左を折れ線グラフで表示
- **MLX**：対象物温度（Object）の右／左を折れ線グラフで表示
- 最大50点までリアルタイムに更新（古い点は削除）

### データ保存
- 計測データはブラウザ上に蓄積
- 「一括ダウンロード」ボタンでExcelファイルを生成
  - シート構成：`MAX_R`, `MAX_L`, `MLX_R`, `MLX_L`
  - JST時刻付きで保存

---

## 3. データフロー図

```mermaid
flowchart LR
    subgraph User["ユーザ操作"]
      U1[接続ボタン] --> U2[計測開始／停止]
      U2 --> U3[一括DL]
    end

    subgraph BrowserApp["ブラウザ内Webアプリ（index.html + app.js）"]
      A1[Web Bluetooth API] 
      A2[通知イベントhandler]
      A3[ログ配列MAX.receivedData，MLX.receivedData]
      A4[UI更新（数値）]
      A5[Chart.jsグラフ更新]
      A6[SheetJSでExcel生成]
    end

    subgraph MAX["MAX30102（心拍）"]
      M1[(GATT Service)] --> M2[(BPM特性 8byte)] 
      M1 --> M3[(距離フラグ特性 1byte)]
    end

    subgraph MLX["MLX90632（温度）"]
      L1[(GATT Service)] --> L2[(温度特性 12byte)]
    end

    U1 -- デバイス選択・接続 --> A1
    A1 <-- GATT接続／通知開始 --> M1
    A1 <-- GATT接続／通知開始 --> L1

    M2 -- Notify(8B) --> A2
    M3 -- Notify(1B) --> A2
    L2 -- Notify(12B) --> A2

    A2 --> A4
    A2 --> A5
    A2 --> A3

    U2 -- 開始/停止 --> A1
    U3 -- クリック --> A6 --> A3


```

---

## 4. シーケンス図

```mermaid
sequenceDiagram
    participant User as ユーザ
    participant App as Webアプリ（Browser）
    participant MAX as MAX30102
    participant MLX as MLX90632

    User->>App: ①「MAX接続」クリック
    App->>MAX: ② GATT接続（サービス／特性取得）
    MAX-->>App: ③ 接続完了

    User->>App: ④「MLX接続」クリック
    App->>MLX: ⑤ GATT接続（サービス／特性取得）
    MLX-->>App: ⑥ 接続完了

    Note over App: 両方接続済み→「計測開始」ボタンが有効化

    User->>App: ⑦「計測開始」クリック
    App->>MAX: ⑧ BPM特性，距離フラグ特性の通知開始
    App->>MLX: ⑨ 温度特性の通知開始

    MAX-->>App: ⑩ Notify: BPM+elapsed_ms（8B）
    App->>App: ⑪ BPM移動平均更新→UI更新→グラフ更新→ログ配列へpush

    MAX-->>App: ⑫ Notify: 距離フラグ（1B）
    App->>App: ⑬ 装着状態の表示切替（色・文言）

    MLX-->>App: ⑭ Notify: Ambient,Object,elapsed_ms（12B）
    App->>App: ⑮ UI更新→グラフ更新→ログ配列へpush
    App->>App: ⑯ （1Hz程度）最新値のUI反映タイマー

    User->>App: ⑰「計測停止」クリック
    App->>MAX: ⑱ 通知停止（listener解除）
    App->>MLX: ⑲ 通知停止（listener解除，タイマー停止）

    User->>App: ⑳「一括DL」クリック
    App->>App: ㉑ SheetJSでExcel生成（MAXシート，MLXシート）
    App-->>User: ㉒ .xlsx ダウンロード


```

---

## 5. 利用ライブラリ
- **Chart.js**: リアルタイム折れ線グラフ描画
- **SheetJS (xlsx.js)**: Excelファイル生成

---

## 6. 注意点
- デバイス名は Arduino 側で「MAX R」「MAX L」「MLX R」「MLX L」と設定すること
- 4台すべて接続されないと計測は開始できない
- データ保存はブラウザ上のみ（サーバ通信なし）

