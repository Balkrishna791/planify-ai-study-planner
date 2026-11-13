# Planify public-demo deployment

Planify is deployed as **one Docker web service**: the Flask API serves the
compiled React site from the same HTTPS address. Students need only one link;
there is no public port 3000 or port 5000.

## Before you deploy

1. Create a GitHub repository from this project without adding a README,
   `.gitignore`, or license on GitHub. The local repository files already
   protect `.env` files and databases.
2. Create a managed PostgreSQL database. For a short student demo, a free Neon
   PostgreSQL project is suitable. For paying users, use a backed-up paid plan
   in a region close to your users.
3. Copy the database **connection string** privately. Never paste it into Git,
   LinkedIn, a screenshot, or a frontend file.

## Deploy on Render

1. In Render, choose **New +** -> **Web Service** and connect the GitHub repo.
2. Select **Docker** as the runtime. Render automatically uses the root
   `Dockerfile`; leave build/start commands empty.
3. Choose the closest available region, give the service a name such as
   `planify`, and create the service.
4. Before the first public test, add the environment variables below in the
   Render service dashboard and redeploy. Use the final `onrender.com` URL for
   the two URL settings; replace them after attaching a custom domain.

## Required production environment variables

In the hosting provider's environment-variable dashboard, add:

```text
PLANIFY_DATABASE_URL=<managed PostgreSQL connection URL>
PLANIFY_SECRET_KEY=<a new long random secret, never the development value>
GEMINI_API_KEY=<your Gemini server API key>
PLANIFY_CORS_ORIGINS=https://your-service-name.onrender.com
PLANIFY_PUBLIC_URL=https://your-service-name.onrender.com
PLANIFY_DEBUG=false
```

Never put any of these values in frontend files, Git, screenshots, or public
messages. `PLANIFY_DATABASE_URL` overrides the standard `DATABASE_URL` if both
are present.

`PLANIFY_DATABASE_URL` overrides the standard `DATABASE_URL` if both are
present. The database tables and indexes are created at startup.

## Verify before sharing the link

The backend creates its tables and indexes at startup. After deployment, visit:

```text
https://your-service-name.onrender.com/health
https://your-service-name.onrender.com/robots.txt
https://your-service-name.onrender.com/sitemap.xml
```

`/health` must return `{"status":"ok", ... "database":"ok"}`. Then create
one disposable test account, add one subject and topic, enter sleep hours,
upload a small syllabus/PYQ only if desired, and generate a plan. Delete that
account afterwards from Profile. Test the same URL in an incognito browser on
your phone before posting publicly.

## Important limits

- Do **not** run public traffic on SQLite. A deployed server filesystem can be
  temporary and SQLite is not designed for concurrent public users.
- A free database is only suitable for a short beta. Export/back up real user
  data before any provider expiry or plan change.
- Existing local SQLite data is not copied automatically. Before moving any real
  student data, make a backup and perform a reviewed one-time migration.
