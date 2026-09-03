# PrimeOS brand crawler

Cloud Run service for reading an official website with Chromium. It respects a site-wide `robots.txt` disallow, stays on the original origin, blocks private-network targets, and treats page content as data only.

Required environment variable: `BRAND_CRAWLER_SECRET`.

Deploy:

```bash
gcloud run deploy primeos-brand-crawler --source services/brand-crawler --region me-west1 --allow-unauthenticated --set-env-vars BRAND_CRAWLER_SECRET=<random-secret> --min-instances 0 --max-instances 2 --memory 2Gi --timeout 300
```

The HTTP service is publicly reachable but `/analyze` requires the bearer secret. Put its full endpoint (`https://…run.app/analyze`) and same secret in Supabase secrets as `BRAND_CRAWLER_URL` and `BRAND_CRAWLER_SECRET`.
