FROM node:24-alpine
WORKDIR /app
COPY shared/themes.cjs ./shared/themes.cjs
COPY server/index.cjs ./server/index.cjs
RUN mkdir -p /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=17896 DATA_DIR=/data
EXPOSE 17896
CMD ["node", "server/index.cjs"]
