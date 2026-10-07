const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;
const SHA = /^[a-f0-9]{40}$/iu;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/iu;

export function deploymentIdentity(env, config) {
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG;
  const commit = env.VERCEL_GIT_COMMIT_SHA;
  const host = env.VERCEL_URL;
  if (env.VERCEL_GIT_PROVIDER !== 'github' || !OWNER.test(owner || '')
      || !REPO.test(repo || '') || repo === '.' || repo === '..'
      || repo.toLowerCase().endsWith('.git') || !SHA.test(commit || '')
      || !HOST.test(host || '') || !Number.isInteger(config?.step)
      || config.step < 1 || config.step > 12
      || typeof config.judgeIssuer !== 'string'
      || !/^https:\/\/[a-z0-9-]+\.up\.railway\.app\/defense\/judge$/iu.test(config.judgeIssuer)
      || typeof config.sampleMarker !== 'string'
      || !/^[A-Z0-9_]{1,80}$/u.test(config.sampleMarker)) {
    throw new Error('배포 식별 정보를 확인할 수 없습니다. Vercel 시스템 환경변수와 aleph.config.json의 step을 확인하세요.');
  }
  const identity = {
    schema: 'aleph.defense.deployment.v1',
    step: config.step,
    repoUrl: `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`,
    commit: commit.toLowerCase(),
    publicAppUrl: `https://${host.toLowerCase()}`,
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  };
  // 3단계부터 aleph.config.json에 적은 허용 경로를 /aleph.json에도 공개합니다(경로 이름만, 비밀값 없음).
  const routes = config.allowedRoutes;
  if (Array.isArray(routes) && routes.length && routes.every(route => typeof route === 'string' && route.length <= 200)) {
    identity.allowedRoutes = [...routes];
  }
  // 5단계부터 원본 자료 API의 HTTPS 경로(쿼리·사용자 정보 없음)를 /aleph.json에도 공개합니다. 비밀값이 아닌 주소만 담습니다.
  const original = config.originalApiUrl;
  if (typeof original === 'string' && original.length <= 250) {
    try {
      const url = new URL(original);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.hostname.includes('.')) {
        identity.originalApiUrl = original;
      }
    } catch {
      // 주소 형식이 맞지 않으면 담지 않습니다. 제출 묶음 점검이 이를 오류로 알려 줍니다.
    }
  }
  return identity;
}
