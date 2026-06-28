# הנחיות עבודה עם Agents Skills

## סקילים מותקנים

### 1. **nodejs-backend-patterns**
מקור: https://github.com/wshobson/agents
- **שימוש**: דפוסים וטובות מנהגות לפיתוח Backend עם Node.js
- **כשמשתמשים בו**: כל פעם שאתה כותב קוד Backend, API endpoints, middleware, database queries, או שרות

### 2. **nodejs-best-practices**
מקור: https://github.com/sickn33/antigravity-awesome-skills
- **שימוש**: טובות מנהגות וקונוונציות לפרויקטי Node.js
- **כשמשתמשים בו**: תכנון ארכיטקטורה, בחירת libraries, מבנה קבצים, error handling

### 3. **vercel-react-best-practices**
מקור: https://github.com/vercel-labs/agent-skills
- **שימוש**: טובות מנהגות React עם Vercel
- **כשמשתמשים בו**: כל פעם שאתה כותב React components, handling state, optimization, performance
- **דגש**: ISR, Server Components, data fetching patterns, Vercel-specific optimizations

### 4. **supabase**
מקור: https://github.com/supabase/agent-skills
- **שימוש**: עבודה עם Supabase לכל הצרכים
- **כשמשתמשים בו**:
  - 🗄️ Database schema, queries, migrations
  - 🔐 Authentication ו-RLS (Row Level Security)
  - 💾 Storage files
  - ⚡ Edge Functions
  - 🔄 Realtime subscriptions
  - 🔗 supabase-js client
  - 🎨 React ו-Next.js integrations

### 5. **supabase-postgres-best-practices**
מקור: https://github.com/supabase/agent-skills
- **שימוש**: טובות מנהגות ו-optimization ל-Postgres
- **כשמשתמשים בו**:
  - 🔍 Query optimization, indexes, EXPLAIN ANALYZE
  - 📊 Schema design ו-normalization
  - ⚡ Performance tuning
  - 🔒 Security: encryption, authentication
  - 🗂️ Data integrity ו-constraints
  - 📈 Scaling strategies

---

## הנחיות עבודה

### בתחילת תזכורת/שימוש בסקיל

כל סקיל יש להשתמש בו עם `/` בתחילת הקטע:
```
/nodejs-backend-patterns
/nodejs-best-practices
/vercel-react-best-practices
/supabase
/supabase-postgres-best-practices
```

### סדר הסקילים לפי שלב פיתוח

**1. תכנון ארכיטקטורה** 
- `nodejs-best-practices` - תכנון כללי
- `vercel-react-best-practices` - ל-frontend
- `supabase` - ל-database ו-backend

**2. כתיבת Backend**
- `nodejs-backend-patterns` - דפוסים
- `nodejs-best-practices` - קונוונציות
- `supabase` - עבודה עם database/auth

**3. כתיבת Frontend**
- `vercel-react-best-practices` - React patterns
- `supabase` - integration עם client

**4. Deployment**
- `vercel-react-best-practices` - Vercel-specific
- `supabase` - database migrations

---

## חוקים לעבודה יעילה

### ✅ כשמתחיל task חדש
```
אני עובד על [task description]
השתמש בסקילים הבאים:
- [סקיל 1] כי [סיבה]
- [סקיל 2] כי [סיבה]
```

### ✅ בעיות ו-debugging
לאחר שהבחנת בבעיה:
```
יש לי בעיה עם [description]
בדוק עם [סקיל] אם יש דפוס או approach שהיה עוזר
```

### ✅ Code review מיד אחרי writing
```
בדוק את הקוד שכתבתי לפי:
- /nodejs-best-practices (אם backend)
- /vercel-react-best-practices (אם frontend)
- /supabase (אם database/auth)
- /supabase-postgres-best-practices (אם database queries/schema)
```

### ✅ Integration בין סקילים
כשאתה משלב מרכיבים:
```
יש לי Backend עם [tool], Frontend עם React, ו-Database עם Supabase
בדוק אם ה-integration בין:
- Backend patterns
- React best practices
- Supabase client integration
זה עוקב אחרי כל הטובות מנהגות
```

---

## המלצות ספציפיות לפרויקט

### Backend (Node.js + Supabase)
1. השתמש ב-Supabase client עם proper error handling
2. Implement RLS rules לכל table
3. Use migrations לכל schema change
4. Follow nodejs-backend-patterns לארכיטקטורה

### Frontend (React + Vercel)
1. Use Server Components כאשר אפשר
2. Implement Supabase auth עם session management
3. Real-time updates דרך Supabase subscriptions
4. Optimize images ו-fonts לפי Vercel best practices
5. בכל Modal / Dialog / Bottom-sheet: חובה לאפשר סגירה עם `Escape`, סגירה בלחיצה על הרקע מחוץ לתוכן, כפתור X גלוי עם `aria-label="סגירה"`, ולמנוע סגירה מלחיצה בתוך תוכן המודאל.
6. במודאלים בעברית: להשתמש ב-`dir="rtl"`, `role="dialog"` ו-`aria-modal="true"` כאשר המודאל חוסם את המסך.

### Fullstack (Next.js)
1. API Routes בـ `app/api/` עם Backend patterns
2. Server Components כברירת מחדל
3. Supabase client ב-browser וב-server
4. ISR/Revalidation strategy

---

## 📊 סיכום הסקילים

| סקיל | שימוש עיקרי | כשמשתמשים |
|------|-----------|----------|
| **nodejs-backend-patterns** | Backend דפוסים | API, middleware, database queries |
| **nodejs-best-practices** | תכנון וקונוונציות | ארכיטקטורה, structure, error handling |
| **vercel-react-best-practices** | React optimization | Components, state, performance, ISR |
| **supabase** | Database + Auth | DB schema, Auth, RLS, Edge Functions |
| **supabase-postgres-best-practices** | Postgres optimization | Query tuning, indexes, schema design |

---

## כמה ליזכור

- **סקילים אלה משלימים זה את זה** - לא יתנגדו
- **תמיד בדוק עם הסקיל הרלוונטי** לפני סיום task
- **אם אתה אומר "תתקן את זה לפי [סקיל]"** - אני אשתמש בו
- **סקילים מפורסמים ומתוחזקים** - ניתן לסמוך עליהם בביטחון

---

---

## 🗄️ עבודה עם Supabase

### תצורה וחיבור

הפרויקט מוגדר לחיבור לSupabase בדרך הבאה:

#### משתנים סביבה
- **`.env`** - משתנים לאפליקציה (Browser + Server)
  - `NEXT_PUBLIC_SUPABASE_URL` - URL של הפרויקט
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public key (בטוח בבראוזר עם RLS)
  - `SUPABASE_SERVICE_ROLE_KEY` - Secret key (סרוור בלבד)

- **`.env.supabase.local`** - משתנים עבור Supabase CLI
  - משמש ל-`supabase start`, migrations, ו-local development

#### פרויקט Supabase
- **Project ID**: `tgropjisnheppsxejfdn`
- **URL**: `https://tgropjisnheppsxejfdn.supabase.co`
- **Dashboard**: https://supabase.com/dashboard/project/tgropjisnheppsxejfdn

### פקודות Supabase CLI שימושיות

```bash
# התחבר לפרויקט
supabase link --project-ref tgropjisnheppsxejfdn

# התחל local development
supabase start

# עצור local environment
supabase stop

# בדוק status
supabase status

# אתחול migrations
supabase migration new <migration_name>

# הפעל migrations
supabase db push

# Pull schema מ-production
supabase db pull

# צפה ב-logs
supabase logs --local
```

### כשאתה עובד עם Database

1. **Schema Changes**: תמיד צור migration קודם:
   ```bash
   supabase migration new create_users_table
   ```

2. **RLS Rules**: כתוב RLS policies בכל table:
   ```sql
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can read their own data" ON users
     FOR SELECT USING (auth.uid() = id);
   ```

3. **Testing**: בדוק עם `/supabase-postgres-best-practices` לכל query

4. **Production**: שימוש עם Service Role Key בלבד (never expose):
   ```typescript
   const supabase = createClient(URL, SERVICE_ROLE_KEY);
   ```

### כשאתה עובד עם Auth

1. **Client-side**: השתמש ב-Anon Key (safe in browser):
   ```typescript
   const { data, error } = await supabase.auth.signUp({
     email: "user@example.com",
     password: "password"
   });
   ```

2. **Server-side**: השתמש בSession:
   ```typescript
   const { data: { session } } = await supabase.auth.getSession();
   ```

### Real-time Subscriptions

```typescript
// Subscribe לשינויים בטבלה
const subscription = supabase
  .channel('schema-db-changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'messages' },
    (payload) => console.log('Change received!', payload)
  )
  .subscribe();

// ניקוי
subscription.unsubscribe();
```

### Edge Functions

```bash
# צור edge function
supabase functions new hello

# בדוק locally
supabase functions serve

# deploy ל-production
supabase functions deploy hello
```

### כללים חשובים
- ✅ תמיד השתמש בRLS לכל table
- ✅ בדוק עם `/supabase-postgres-best-practices` בכל query
- ✅ Service Role Key רק בserver/edge functions
- ✅ Real-time יוקר - השתמש בזהירות
- ✅ Migrations תמיד לפני schema changes

---

## מנגנון זכירה

כל הגנות אלה נשמרות בזיכרון הפרויקט. אם יש לך הוראות חדשות לעבודה עם הסקילים או Supabase, תגיד והן יתעדכנו בקובץ זה.
