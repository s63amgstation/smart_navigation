# 가볍고 보안 패치 빠른 alpine 기반 노드
FROM node:24-alpine

WORKDIR /app

# 의존성만 먼저 복사·설치해서 캐시 효율을 올린다 (소스 변경 시 재설치 안 함)
COPY package*.json ./
RUN npm install --omit=dev

# 나머지 소스 (.dockerignore 가 .env / node_modules / .git 등은 걸러줌)
COPY . .

# Render 는 PORT 환경변수를 주입한다. EXPOSE 는 문서용.
EXPOSE 3000

# npm 래퍼 없이 node 로 직접 실행 → SIGTERM 이 그대로 전달돼 깔끔한 셧다운
CMD ["node", "server/index.js"]
