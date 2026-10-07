import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('/aleph.json에 허용 경로와 원본 자료 HTTPS 주소가 담긴다', () => {
  const identity = deploymentIdentity(env, config);
  assert.ok(identity.allowedRoutes.length >= 1);
  assert.match(identity.originalApiUrl, /^https:\/\//u);
  assert.equal(identity.originalApiUrl, config.originalApiUrl);
  // 비밀값이나 키 이름이 /aleph.json에 들어가지 않는다.
  assert.doesNotMatch(JSON.stringify(identity), /sb_(publishable|secret)_|service_role|apikey|password/iu);
});

test('쿼리·사용자 정보가 있거나 HTTPS가 아닌 원본 주소는 /aleph.json에 담지 않는다', () => {
  for (const bad of [
    'http://project.supabase.co/rest/v1/user_notes',
    'https://project.supabase.co/rest/v1/user_notes?apikey=secret',
    'https://user:pw@project.supabase.co/rest/v1/user_notes',
    'https://project.supabase.co/rest/v1/user_notes#frag',
    'not a url',
    null,
  ]) {
    assert.equal('originalApiUrl' in deploymentIdentity(env, { ...config, originalApiUrl: bad }), false, String(bad));
  }
});
