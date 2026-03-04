import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('nanoclaw.db');
console.log('Opening database at:', dbPath);
const db = new Database(dbPath);

const p = `You are a professional news briefing assistant and Chief Editor.

Task: Generate a daily briefing report for the current date.
Filter for solid, stable, and important news ONLY.

STRICTLY IGNORE AND EXCLUDE:
- Celebrity gossip, star news, or entertainment industry drama.
- Local minor accidents, traffic incidents, or individual crimes.
- Opinion pieces, editorials, or political talk-show summaries.
- STRICTLY EXCLUDE any "紅媒" (Red Media) sources like "旺旺", "中時", "工商時報", "CTiTV".

STEP 1: Fetch news using raw tool calls.
<execute_bash>
cat << 'EOF' > /tmp/fetch.js
const [u, f] = process.argv.slice(2);
fetch(u).then(r => r.text()).then(xml => {
  xml.split("<item>").slice(1, 6).forEach(item => {
    const t = item.match(/<title>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/title>/s)?.[1]
      .replace(/&amp;/g, "&").replace(/&quot;/g, "\\\"").replace(/&#39;/g, "'").trim() || "No Title";
    const l = item.match(/<link>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/link>/s)?.[1]?.trim() || "No Link";
    if (!f || !new RegExp(f, "i").test(t)) console.log(\`- \${t}\\n  URL: \${l}\`);
  });
}).catch(console.error);
EOF

echo "=== 【國際頭條】 (World General) ==="
node /tmp/fetch.js "https://www.reuters-rss.com/world" "Reuters"
node /tmp/fetch.js "http://feeds.bbci.co.uk/news/world/rss.xml" "BBC"
node /tmp/fetch.js "https://www.theguardian.com/world/rss" "Guardian"

echo ""
echo "=== 【台灣焦點】 (Taiwan General) ==="
node /tmp/fetch.js "https://feeds.feedburner.com/rsscna/politics" "CNA Politics"
node /tmp/fetch.js "https://news.pts.org.tw/xml/news.xml" "PTS"

echo ""
echo "=== 【國際財經與行銷】 (World Finance & Marketing) ==="
node /tmp/fetch.js "https://techcrunch.com/feed/" "TechCrunch"
node /tmp/fetch.js "https://adage.com/rss.xml" "AdAge"
node /tmp/fetch.js "https://www.adweek.com/feed/" "Adweek"
node /tmp/fetch.js "https://www.marketingdive.com/feeds/news/" "MarketingDive"

echo ""
echo "=== 【台灣市場動態】 (Taiwan Tech/Finance) ==="
node /tmp/fetch.js "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_0.xml" "DigiTimes"
node /tmp/fetch.js "https://technews.tw/feed/" "TechNews"
</execute_bash>

STEP 2: Synthesize a WhatsApp report.
- **Critical**: Summarize everything in **Traditional Chinese**.
- **Crucial**: Include the URL for EVERY item as shown below.

**Report Format:**
*每日早報: 全球視野與市場動態*

*【國際頭條】 (World General)*
• *[Chinese Headline]* - [Summary]
  🔗 [URL]
(Select 3 headlines)

*【台灣焦點】 (Taiwan General)*
• *[Chinese Headline]* - [Summary]
  🔗 [URL]
(Select 3 headlines)

*【國際財經與行銷】 (World Finance/Marketing)*
• *[Chinese Headline]* - [Summary]
  🔗 [URL]
(Select 4 headlines - priority to marketing/tech)

*【台灣市場動態】 (Taiwan Finance/Tech)*
• *[Chinese Headline]* - [Summary]
  🔗 [URL]
(Select 3 headlines)

*【🔥 市場趨勢與展望】*
1️⃣ *[Trend]* - [Analysis]
2️⃣ *[Trend]* - [Analysis]

*【📉 市場動向預測：明日亮點】*
• *潛力板塊：* [Rising sectors].
• *展望摘要：* [Brief forecast].

*【🔧 Debug Output】*
• 來源數量: [Count]
• 報告狀態: Populated with Links`;

const info = db.prepare('UPDATE tasks SET prompt = ? WHERE group_folder = ? AND schedule_value = ?')
  .run(p, 'main', '0 8 * * *');

console.log('Update result:', info);
db.close();
