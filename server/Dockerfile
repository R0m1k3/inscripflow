FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache python3 make g++ && npm install && apk del python3 make g++

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
