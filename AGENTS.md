# Clinical project context

Use this folder as the canonical Clinical project. Read project-context.json and deployment-progress.json for the saved context and deployment state. Screenshots are in screenshots/. The website lives directly at the repository root.

Clinical serves Nikki, who handles clinical research business development for Tanner Clinic’s Davis County, Utah locations; sponsor/CRO opportunity discovery can remain nationwide. Study contacts and sponsor/CRO relationships are primary workflows, alongside PI visibility. ARFD means Analyze, Research, Report for Discussion; discuss ARFD proposals before implementing them. Corporate Microsoft 365 access is outside scope; Excel exports and manual Grok/Claude handoffs are supported.

GitHub origin is https://github.com/LargeLow/clinical.git. Render deploys main automatically to https://nikki.uptechprojects.com. Do not push organizational notes merely to trigger a deployment. Use npm test and npm run build for code changes. Source uses Node 22–24, native ES modules, and no runtime package dependencies.

Never print or commit credentials. Runtime secrets remain in Render and the original ignored configuration; none are included in this folder. The assistant uses a fixed 12-hour signed cookie, invalidated by service restarts or deployments. Persistent workspace storage is on the Render disk at /var/data.

The previous local copy at /Users/applelab/Documents/Codex/Clinical is a backup. Do ongoing work here rather than maintaining two source folders.
