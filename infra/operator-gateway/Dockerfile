FROM node:24.11.1-alpine
WORKDIR /app
COPY security.mjs server.mjs ./
ENV NODE_ENV=production GATEWAY_PORT=8080 WEB_ORIGIN=http://web:3000
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
