import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
// 2단계부터 메모는 Supabase에 있고 화면은 /api/notes로 읽습니다.
// 공개 정적 파일 public/data.json에 메모가 다시 들어가면 빌드를 멈춥니다.
const publicData = JSON.parse(await readFile(resolve(root, 'public', 'data.json'), 'utf8'));
if (!Array.isArray(publicData.notes) || publicData.notes.length > 0 || 'sampleMarker' in publicData) {
  throw new Error('public/data.json에 메모나 1단계 확인 표시(sampleMarker)를 두지 마세요. 메모는 서버 API(/api/notes)로만 읽습니다.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
console.log('공개 data.json에 메모가 없음을 확인했습니다.');
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
