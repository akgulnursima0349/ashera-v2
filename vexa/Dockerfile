# Railway için Vexa Lite Dockerfile
# Bu sadece Railway deployment için - local'de docker-compose kullanacağız

FROM vexaai/vexa-lite:latest

# Railway otomatik PORT environment variable verir
ENV PORT=8056

EXPOSE 8056

CMD ["sh", "-c", "vexa-lite"]
