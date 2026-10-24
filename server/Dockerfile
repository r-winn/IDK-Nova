FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY app.mjs ./
COPY web ./web
USER node
ENV NODE_ENV=production NOVA_BIND=0.0.0.0 NOVA_CONFIG=/run/nova/config.json
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "app.mjs"]
