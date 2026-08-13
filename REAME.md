# THG Brain

Self-hosted personal second brain for The High Ground.

## Application

Trilium Notes

## Deployment

Development/configuration:

- Mac: `/Volumes/Dex/Adarsh/TheHighGround/thg-brain`

Production:

- archive: `/opt/thg-brain`

Persistent application data:

- archive: `/opt/thg-brain-data/trilium-data`

Persistent data is intentionally kept outside the Git repository.

## Deploy

```bash
cd /opt/thg-brain
git pull origin main
sudo docker compose pull
sudo docker compose up -d

Local endpoint

http://192.168.0.112:8080