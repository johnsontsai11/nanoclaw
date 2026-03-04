import fs from 'fs';

const SOURCES = {
  '【國際頭條】 (World General)': [
    ['https://www.reuters-rss.com/world', 'Reuters'],
    ['http://feeds.bbci.co.uk/news/world/rss.xml', 'BBC'],
    ['https://www.theguardian.com/world/rss', 'Guardian'],
    ['https://www.aljazeera.com/xml/rss/all.xml', 'Al Jazeera'],
    ['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', 'CNBC International']
  ],
  '【台灣焦點】 (Taiwan General)': [
    ['https://feeds.feedburner.com/rsscna/politics', 'CNA Politics'],
    ['https://news.pts.org.tw/xml/news.xml', 'PTS'],
    ['https://feeds.feedburner.com/rsscna/intworld', 'CNA International'],
    ['https://feeds.feedburner.com/rsscna/social', 'CNA Social'],
    ['https://www.twreporter.org/a/rss.xml', 'The Reporter']
  ],
  '【國際財經與行銷】 (World Finance & Marketing)': [
    ['https://techcrunch.com/feed/', 'TechCrunch'],
    ['https://adage.com/rss.xml', 'AdAge'],
    ['https://www.adweek.com/feed/', 'Adweek'],
    ['https://www.marketingdive.com/feeds/news/', 'MarketingDive'],
    ['https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', 'CNBC Business'],
    ['https://feeds.a.dj.com/rss/RSSMarketsMain.xml', 'WSJ Markets']
  ],
  '【台灣市場動態】 (Taiwan Tech/Finance)': [
    ['https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_0.xml', 'DigiTimes'],
    ['https://technews.tw/feed/', 'TechNews'],
    ['https://feeds.feedburner.com/rsscna/finance', 'CNA Finance'],
    ['https://feeds.feedburner.com/rsscna/technology', 'CNA Tech'],
    ['https://www.moneydj.com/KMDJ/RssFeed.aspx?id=1', 'MoneyDJ']
  ]
};

async function fetchRSS(url, filter) {
  try {
    const response = await fetch(url);
    const xml = await response.text();
    const items = xml.split('<item>').slice(1, 6);
    let results = [];
    
    for (const item of items) {
      const title = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]
        ?.replace(/&amp;/g, '&')
        ?.replace(/&quot;/g, '"')
        ?.replace(/&#39;/g, "'")
        ?.trim() || "No Title";
      
      const link = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/s)?.[1]?.trim() || "No Link";
      
      if (!filter || !new RegExp(filter, 'i').test(title)) {
        results.push(`- ${title}\n  URL: ${link}`);
      }
    }
    return results.join('\n');
  } catch (e) {
    return `Error fetching ${url}: ${e.message}`;
  }
}

async function main() {
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
