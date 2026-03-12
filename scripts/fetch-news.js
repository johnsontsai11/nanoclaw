import fs from 'fs';

const SOURCES = {
  '【國際頭條】 (World General)': [
    ['https://www.scmp.com/rss/2/feed', 'SCMP World'],
    ['http://feeds.bbci.co.uk/news/world/rss.xml', 'BBC'],
    ['https://www.theguardian.com/world/rss', 'Guardian'],
    ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
    ['https://finance.yahoo.com/news/rssindex', 'Yahoo Finance'],
    ['https://www.reuters-rss.com/world', 'Reuters']
  ],
  '【台灣焦點】 (Taiwan General)': [
    ['https://feeds.feedburner.com/rsscna/politics', 'CNA Politics'],
    ['https://news.ltn.com.tw/rss/all.xml', 'LTN All News'],
    ['https://www.twreporter.org/a/rss2.xml', 'The Reporter'],
    ['https://news.pts.org.tw/xml/news.xml', 'PTS'],
    ['https://feeds.feedburner.com/rsscna/intworld', 'CNA International'],
    ['https://feeds.feedburner.com/rsscna/culture', 'CNA Culture'],
    ['https://news.ltn.com.tw/rss/politics.xml', 'LTN Politics'],
    ['https://tw.news.yahoo.com/rss/politics', 'Yahoo TW Politics'],
    ['https://feeds.feedburner.com/rsscna/social', 'CNA Social']
  ],
  '【國際財經與行銷】 (World Finance & Marketing)': [
    ['https://techcrunch.com/feed/', 'TechCrunch'],
    ['https://digiday.com/feed/', 'Digiday'],
    ['https://www.adweek.com/feed/', 'Adweek'],
    ['https://adage.com/rss.xml', 'AdAge'],
    ['https://www.marketingdive.com/feeds/news/', 'MarketingDive'],
    ['https://feeds.a.dj.com/rss/RSSMarketsMain.xml', 'WSJ Markets']
  ],
  '【台灣市場動態】 (Taiwan Tech/Finance)': [
    ['http://www.cw.com.tw/RSS/global.xml', 'CommonWealth'],
    ['https://buzzorange.com/techorange/feed/', 'TechOrange'],
    ['https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_0.xml', 'DigiTimes'],
    ['https://technews.tw/feed/', 'TechNews'],
    ['https://www.ithome.com.tw/rss.xml', 'iThome'],
    ['https://feeds.feedburner.com/rsscna/finance', 'CNA Finance'],
    ['https://www.moneydj.com/KMDJ/RssFeed.aspx?id=1', 'MoneyDJ']
  ]
};

async function fetchRSS(url, filter) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const items = xml.split('<item>').slice(1);
    let results = [];
    
    // threshold: 48 hours ago
    const threshold = Date.now() - (48 * 60 * 60 * 1000);

    for (const item of items) {
      if (results.length >= 5) break;

      const pubDateMatch = item.match(/<(?:pubDate|dc:date)>(.*?)<\/(?:pubDate|dc:date)>/s);
      const pubDateStr = pubDateMatch ? pubDateMatch[1].trim() : null;
      const pubTime = pubDateStr ? new Date(pubDateStr).getTime() : Date.now(); // Assume current if missing

      // Filter by date
      if (pubTime < threshold) continue;

      const title = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]
        ?.replace(/&amp;/g, '&')
        ?.replace(/&quot;/g, '"')
        ?.replace(/&#39;/g, "'")
        ?.trim() || "No Title";
      
      const link = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/s)?.[1]?.trim() || "No Link";
      
      // Extract description or content:encoded for richness
      let description = item.match(/<(?:description|content:encoded)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/(?:description|content:encoded)>/s)?.[1] || "";
      
      // Clean up description (remove HTML, decode entities)
      description = description
        .replace(/<[^>]*>/g, '') 
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!filter || !new RegExp(filter, 'i').test(title)) {
        results.push(`- Title: ${title}\n  Published: ${new Date(pubTime).toLocaleString()}\n  Summary Context: ${description.slice(0, 1000)}\n  URL: ${link}`);
      }
    }
    return results.join('\n\n');
  } catch (e) {
    return `Error fetching ${url}: ${e.message}`;
  }
}

async function main() {
  console.log(`Current Time: ${new Date().toLocaleString()}\n`);
  for (const [section, feedList] of Object.entries(SOURCES)) {
    console.log(`=== ${section} ===`);
    for (const [url, filter] of feedList) {
      const output = await fetchRSS(url, filter);
      if (output) console.log(output);
    }
    console.log('');
  }
}

main();
