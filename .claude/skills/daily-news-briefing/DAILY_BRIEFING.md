# Daily News Briefing

This skill sets up a daily automated briefing that delivers Global and Taiwan news along with financial market updates every morning at 8:00 AM.

## Features
- **Global News:** Top 5 headlines from CNA, Reuters, AP.
- **Local News:** Top 5 Taiwan headlines from CNA and The Reporter.
- **Financial Markets:** US market close summary and Taiwan market opening outlook.
- **Financial News:** Top 5 economic stories with Taiwan-specific terminology.

## Management
The briefing is registered as a standard **Scheduled Task** in NanoClaw.

- To list tasks: `@Dart list scheduled tasks`
- To pause: `@Dart pause task [ID]`
- To edit: You can ask Dart to "update the briefing task to include [X]"

The briefing is stored in the database. When it runs, it saves a copy to:
`/workspace/group/daily_reports/briefing_YYYY-MM-DD.md`
