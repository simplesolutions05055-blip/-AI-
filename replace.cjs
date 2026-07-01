const fs = require('fs');
const path = require('path');

const files = [
  'src/pages/OnboardingPage.tsx',
  'src/pages/SignupPage.tsx',
  'src/pages/admin/AdminLayout.tsx',
  'src/pages/admin/BrandingPage.tsx',
  'src/pages/admin/ConversationsPage.tsx',
  'src/pages/admin/CostsPage.tsx',
  'src/pages/admin/DashboardPage.tsx',
  'src/pages/admin/ErrorsPage.tsx',
  'src/pages/admin/FilesPage.tsx',
  'src/pages/admin/ModelsPage.tsx',
  'src/pages/admin/PermissionsPage.tsx',
  'src/pages/admin/RequestsPage.tsx',
  'src/pages/admin/RevisePage.tsx',
  'src/pages/admin/SettingsPage.tsx',
  'src/pages/admin/SkillsPage.tsx'
];

for (const file of files) {
  const fullPath = path.join(process.cwd(), file);
  if (!fs.existsSync(fullPath)) continue;
  
  let content = fs.readFileSync(fullPath, 'utf8');
  let originalContent = content;
  
  if (content.includes('טוען...')) {
    // 1. In ternaries or string returns, we want JSX <Spinner />. 
    // Usually it's in a JSX block like {loading ? 'טוען...' : '...'}
    content = content.replace(/'טוען\.\.\.'/g, '<Spinner />');
    
    // 2. Direct text node replacements
    content = content.replace(/>טוען\.\.\.<\/div>/g, '><Spinner /></div>');
    content = content.replace(/>טוען\.\.\.<\/p>/g, '><Spinner /></p>');
    content = content.replace(/>טוען\.\.\.<\/main>/g, '><Spinner /></main>');
    content = content.replace(/>טוען\.\.\.<\/td>/g, '><div className="flex justify-center"><Spinner /></div></td>');
    content = content.replace(/>טוען\.\.\.<\/span>/g, '><Spinner className="h-3 w-3" /></span>');
    content = content.replace(/>טוען\.\.\.\n/g, '><Spinner />\n');
    content = content.replace(/טוען\.\.\./g, '<Spinner />'); // Fallback

    if (content !== originalContent && !content.includes("import { Spinner }")) {
      const lines = content.split('\n');
      const lastImportIndex = lines.findLastIndex(line => line.startsWith('import'));
      if (lastImportIndex !== -1) {
        lines.splice(lastImportIndex + 1, 0, "import { Spinner } from '@/components/ui/Spinner';");
      } else {
        lines.unshift("import { Spinner } from '@/components/ui/Spinner';");
      }
      content = lines.join('\n');
      fs.writeFileSync(fullPath, content, 'utf8');
      console.log(`Updated ${file}`);
    }
  }
}
