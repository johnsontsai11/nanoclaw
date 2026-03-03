import { initDatabase, getAllTasks, createTask, updateTask } from '../src/db.js';
import { logger } from '../src/logger.js';

const BRIEFING_PROMPT = `*每日早報生成任務*

目標：每天早上8:00執行，生成一份包含全球、台灣重要新聞與財經市場分析的早報。

*執行步驟：*

1.  *設定日期：* 獲取當前日期，格式為 YYYY-MM-DD，用於檔案命名與報告內容。

2.  *第一部分：一般新聞頭條 (國際與本地)*
    *   *搜尋策略：*
        *   使用 \`agent-browser\` 進行網路搜尋。
        *   搜尋「全球前五大新聞」、「台灣前五大新聞」。
        *   優先使用以下來源進行篩選與確認：
            *   中央通訊社 (CNA)
            *   報導者 (The Reporter)
            *   路透社 (Reuters)
            *   美聯社 (AP)
    *   *內容萃取：*
        *   從搜尋結果中選取最具代表性的五則全球新聞和五則台灣本地新聞。
        *   針對每則新聞，擷取：
            *   新聞標題
            *   兩句話的精簡摘要
            *   原始新聞來源連結

3.  *第二部分：金融市場與財經新聞*
    *   *搜尋策略：*
        *   使用 \`agent-browser\` 進行網路搜尋。
        *   搜尋「美國股市收盤」、「台灣股市開盤展望」、「影響台灣科技業或全球經濟的財經新聞」。
        *   優先使用以下來源進行篩選與確認：
            *   工商時報 (Commercial Times)
            *   經濟日報 (Economic Daily News)
            *   彭博 (Bloomberg)
            *   CNBC
    *   *內容萃取：*
        *   總結美國股市收盤情況及台灣股市開盤展望。
        *   選取影響台灣科技業或全球經濟的五則主要財經新聞。
        *   針對每則新聞，擷取：
            *   新聞標題
            *   兩句話的精簡摘要
            *   原始新聞來源連結
        *   確保使用台灣金融術語，例如「漲跌幅」、「殖利率」、「半導體」。

4.  *格式化輸出：*
    *   將所有收集到的資訊整理成一份 Markdown 格式的報告。
    *   使用清晰的條列式佈局。
    *   報告範例如下：

\`\`\`markdown
# 每日早報 (YYYY-MM-DD)

## 焦點新聞

### 國際頭條

• *[國際新聞標題 1]*
    [兩句話的精簡摘要。]
    來源：[連結]

... (共五則)

### 台灣頭條

• *[台灣新聞標題 1]*
    [兩句話的精簡摘要。]
    來源：[連結]

... (共五則)

## 財經市場與新聞

### 市場概況

• *美國股市收盤：* [簡述道瓊、那斯達克等主要指數的漲跌幅和主要影響因素。]
• *台灣股市開盤展望：* [簡述今日台股開盤的預期走勢，可能受到的國際與本地因素影響。]

### 財經要聞

• *[財經新聞標題 1]*
    [兩句話的精簡摘要，提及相關的漲跌幅、殖利率、半導體等術語。]
    來源：[連結]

• *[財經新聞標題 2]*
    [兩句話的精簡摘要，提及相關的漲跌幅、殖利率、半導體等術語。]
    來源：[連結]

... (共五則)
\`\`\`

9.  *儲存報告：*
    *   將最終的早報內容儲存至檔案：`/workspace/group/daily_reports/briefing_YYYY-MM-DD.md`。
    *   確保 `daily_reports` 資料夾存在，如果沒有則使用 `<execute_bash>` 建立。

6.  *發送報告：*
    *   儲存檔案後，請**務必將完整的早報 Markdown 內容作為你的最終對話回覆輸出**，不要只說「已儲存」。這樣系統才能自動將早報發送給使用者。`;

async function main() {
  initDatabase();
  const tasks = getAllTasks();
  
  const existing = tasks.find(t => t.prompt.includes('每日早報生成任務') || t.prompt.includes('Daily Morning Briefing Task'));
  
  const taskId = existing ? existing.id : `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  
  const task = {
    id: taskId,
    group_folder: 'main',
    chat_jid: existing ? existing.chat_jid : '',
    prompt: BRIEFING_PROMPT,
    schedule_type: 'cron' as const,
    schedule_value: '0 8 * * *',
    context_mode: 'group' as const,
    status: 'active' as const,
    next_run: existing ? existing.next_run : null,
    created_at: existing ? existing.created_at : new Date().toISOString()
  };

  if (existing) {
    updateTask(taskId, task);
  } else {
    createTask(task);
  }
  console.log(existing ? 'Successfully updated daily briefing task:' : 'Successfully created daily briefing task:', taskId);
}

main().catch(err => {
  console.error('Failed to setup briefing:', err);
  process.exit(1);
});
