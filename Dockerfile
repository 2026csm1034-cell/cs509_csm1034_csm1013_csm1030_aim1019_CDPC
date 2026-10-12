# Stage 1: build the React app
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: API + built client
FROM node:22-alpine
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
ENV PORT=4000
EXPOSE 4000
CMD ["npm", "start"]
