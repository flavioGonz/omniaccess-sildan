cd /opt/OmniAccess
DBURL=$(grep -E '^DATABASE_URL' .env | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//; s/\?.*$//')
psql "$DBURL" -t -A -c "SELECT id||' | started='||\"startedAt\"||' | ended='||COALESCE(\"endedAt\"::text,'OPEN')||' | lastValue='||COALESCE(\"lastValue\"::text,'-') FROM \"CameraOutage\" ORDER BY \"startedAt\" DESC LIMIT 5;"
