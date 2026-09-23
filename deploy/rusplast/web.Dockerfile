FROM nginx:stable-alpine
COPY deploy/rusplast/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/dist /usr/share/nginx/html
EXPOSE 80
