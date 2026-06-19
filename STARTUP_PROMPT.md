# 🚀 פרומפט סטארטאפ - פרויקט AI Maor Atiya

## 📌 סקירה כללית

פרויקט **Next.js + React + Supabase** לשירות עיצוב גרפי/AI.

**Stack:**
- Frontend: Next.js + React (TypeScript)
- Backend: Node.js + Next.js API Routes
- Database: Supabase (PostgreSQL)
- Deployment: Vercel
- Styling: TBD (Tailwind/shadcn?)

---

## 🛠️ כל הסקילים המותקנים

### 1. **nodejs-backend-patterns**
משמש: כתיבת backend, API endpoints, middleware, database queries
```
התשתמש בו כשאתה כותב:
/nodejs-backend-patterns
```

### 2. **nodejs-best-practices**
משמש: תכנון ארכיטקטורה, structure, קונוונציות, error handling
```
התשתמש בו כשאתה תוכננת או כותב backend:
/nodejs-best-practices
```

### 3. **vercel-react-best-practices**
משמש: React components, state management, performance, Server Components, ISR
```
התשתמש בו כשאתה כותב frontend:
/vercel-react-best-practices
```

### 4. **supabase**
משמש: Database, Authentication, RLS, Edge Functions, Real-time, Migrations
```
התשתמש בו לכל עבודה עם Supabase:
/supabase
```

### 5. **supabase-postgres-best-practices**
משמש: Query optimization, indexes, schema design, performance tuning
```
התשתמש בו כשאתה כותב queries או משנה schema:
/supabase-postgres-best-practices
```

---

## 🗄️ Supabase - מידע חיבור

### Project Details
```
Project ID: tgropjisnheppsxejfdn
URL: https://tgropjisnheppsxejfdn.supabase.co
Dashboard: https://supabase.com/dashboard/project/tgropjisnheppsxejfdn
Region: Central EU (Frankfurt)
```

### API Keys
```
ANON KEY (בטוח בבראוזר):
sb_publishable_uwGM_HAjV28gchyFZHqZGg_9LjXwIJ-

SECRET KEY (רק בserver):
[REDACTED]

DATABASE PASSWORD:
[REDACTED]
```

### משתנים סביבה
```
קובץ: .env
✅ NEXT_PUBLIC_SUPABASE_URL
✅ NEXT_PUBLIC_SUPABASE_ANON_KEY
✅ SUPABASE_SERVICE_ROLE_KEY
✅ DATABASE_PASSWORD

קובץ: .env.supabase.local
✅ Supabase CLI config
```

### Supabase CLI Status
```
✅ CLI Installed: /opt/homebrew/bin/supabase
✅ Project Linked: tgropjisnheppsxejfdn
✅ Connection: VERIFIED ✨
```

---

## 📖 כללי עבודה

### כשמתחיל עבודה חדשה
```
"אני עובד על [מה שאתה עושה]"
"בדוק עם /supabase-postgres-best-practices אם זה database"
"בדוק עם /vercel-react-best-practices אם זה frontend"
```

### כשסיימת לכתוב קוד
```
"בדוק את הקוד שכתבתי לפי:
- /nodejs-best-practices (אם backend)
- /vercel-react-best-practices (אם frontend)
- /supabase-postgres-best-practices (אם database)"
```

### כשיש בעיה
```
"יש לי בעיה עם [תיאור]"
"בדוק עם [סקיל] אם יש דפוס שמתאים"
```

### Database Work
```
1. בדוק עם /supabase לפני migration
2. צור migration: supabase migration new [name]
3. כתוב schema עם RLS rules
4. בדוק עם /supabase-postgres-best-practices
5. הפעל: supabase db push
```

---

## 🔧 פקודות שימושיות

### Supabase CLI
```bash
# הפעל local development
supabase start

# עצור
supabase stop

# בדוק status
supabase status

# צור migration
supabase migration new create_users_table

# הפעל migrations
supabase db push

# Pull schema מ-production
supabase db pull

# צפה ב-logs
supabase logs --local

# Deploy edge functions
supabase functions deploy hello
```

### Next.js Development
```bash
# Install dependencies
npm install
# או
pnpm install

# הפעל dev server
npm run dev
# או
pnpm dev

# בנה לproduction
npm run build

# בדוק build
npm run start
```

---

## 📋 Workflow לפיתוח

### 1. Setup Initial
```
supabase start
npm install
```

### 2. Database Schema
```
supabase migration new init_schema
[כתוב tables עם RLS]
supabase db push
```

### 3. Authentication
```
/supabase - עיצוב auth flow
/nodejs-backend-patterns - Server-side handling
בנייה של Supabase Auth integration
```

### 4. API Routes
```
/nodejs-backend-patterns - Architecture
/nodejs-best-practices - Convention
כתיבה של API routes ב-app/api/
```

### 5. Frontend
```
/vercel-react-best-practices - Components
כתיבה של React components
Server Components where possible
```

### 6. Styling & UX
```
טיול בדיוק (TBD - Tailwind? shadcn?)
```

### 7. Testing & Deployment
```
בדיקה local
Deployment ל-Vercel
```

---

## ⚠️ חוקים חשובים

### Database
- ✅ תמיד צור migration קודם
- ✅ הוסף RLS rules לכל table
- ✅ בדוק queries עם /supabase-postgres-best-practices
- ✅ Service Role Key רק בserver

### Authentication
- ✅ Use Anon Key בבראוזר (safe with RLS)
- ✅ Use Service Role Key בserver בלבד
- ✅ Never expose secrets

### Code
- ✅ בדוק עם הסקיל הרלוונטי לפני סיום
- ✅ Follow conventions של /nodejs-best-practices
- ✅ Use Server Components ב-Next.js

### Real-time
- ✅ Real-time יוקר - השתמש בזהירות
- ✅ Unsubscribe כאשר component unmount

---

## 📁 מבנה הפרויקט (TBD)

```
/Users/itaykarkason/Python Projects/-AI-maor-atiya/
├── .env                          # משתנים סביבה (gitignored)
├── .env.supabase.local          # Supabase CLI config (gitignored)
├── .gitignore                   # Git ignore rules
├── SKILLS_GUIDELINES.md         # הנחיות עבודה עם סקילים
├── STARTUP_PROMPT.md            # קובץ זה
├── supabase/
│   ├── migrations/              # Database migrations
│   ├── functions/               # Edge Functions
│   └── config.toml              # Supabase config
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── api/                 # API Routes
│   │   └── ...
│   ├── components/              # React Components
│   ├── lib/
│   │   ├── supabase.ts          # Supabase client
│   │   └── ...
│   └── types/                   # TypeScript types
├── package.json
├── tsconfig.json
├── next.config.js
└── tailwind.config.js (if using)
```

---

## 🎯 שלבים ראשונים

### 1. Verify Everything Works
```
supabase projects list
✅ Should see: tgropjisnheppsxejfdn

supabase status
✅ Should show project status
```

### 2. Start Local Development
```
supabase start
# Waits for Docker/database to be ready
```

### 3. Initialize Node.js Project
```
npm init -y
# או אם כבר יש package.json
npm install
```

### 4. Install Dependencies (הצעה)
```
npm install next react react-dom
npm install -D typescript @types/react @types/node
npm install @supabase/supabase-js
npm install -D tailwindcss postcss autoprefixer
```

### 5. Create First Schema
```
supabase migration new init_schema
[edit supabase/migrations/...]
supabase db push
```

### 6. Start Developing
```
npm run dev
# Visit http://localhost:3000
```

---

## 💡 איך להשתמש בפרומפט הזה

### כשאתה בסשן חדש
1. קרא את הפרומפט הזה
2. תגיד לי: "אני מוכן, בואו נשתדל ב[תיאור task]"
3. זכור את הסקילים הרלוונטיים

### כשאתה כותב קוד
```
"אני כותב [תיאור]
בדוק עם /[סקיל רלוונטי]"
```

### כשיש שאלות
```
"איך אני עושה X?"
"בדוק עם /[סקיל] אם יש approach"
```

---

## 📞 פקודות שימושיות לקביעת בדיקות

### לבדוק architecture
```
בדוק עם /nodejs-best-practices אם ה-structure בסדר
```

### לבדוק backend
```
בדוק עם /nodejs-backend-patterns אם ה-patterns נכונים
```

### לבדוק frontend
```
בדוק עם /vercel-react-best-practices אם הcomponents בסדר
```

### לבדוק database
```
בדוק עם /supabase-postgres-best-practices אם ה-queries אופטימליות
```

### לבדוק integration
```
בדוק עם /supabase אם ה-integration עובדת כמו שצריך
```

---

## ✨ כשהכל מוכן

```
🎉 מוכנים לפיתוח!

השלבים:
1. supabase start
2. npm install
3. בנייה של schema initial
4. כתיבה של components
5. testing
6. deployment ל-Vercel

בואו נשתדל! 🚀
```

---

## 📝 Notes

- הפרומפט הזה זמין בכל סשן
- הנחיות מלאות ב-SKILLS_GUIDELINES.md
- חיבור ל-Supabase: ✅ VERIFIED
- כל הסקילים: ✅ INSTALLED
- משתנים סביבה: ✅ CONFIGURED

**אתה מוכן להתחיל!** 🎯
