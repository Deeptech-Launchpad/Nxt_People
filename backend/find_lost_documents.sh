#!/bin/sh
# Hunt for document files that a row points at but the uploads volume does not
# have. READ ONLY — it looks, it never moves or deletes anything.
#
# Seven of Logasundar's onboarding files went missing before documents were
# given folders. They are not in the live uploads volume, and no email ever
# carried a copy: the onboarding mails contain an invite link and nothing
# else. What is left is the filesystem, and the places a copy could plausibly
# survive:
#
#   - a different Docker volume (an old or orphaned one from a rebuild)
#   - a stopped container's writable layer
#   - a stray copy somewhere on the host
#
# Run it ON THE HOST, not inside a container:
#     sudo sh find_lost_documents.sh
#
# The names come from the file_url column of the seven rows.

set -u

FILES="c6800f94050c490f6807f2b8b8655872
4842f91ba307d1d1f7856ef17a02f714
17feb583cc04debd9feee09b63df6bbe
707f1f73db23062437f797d1095487f7
22116cfcd17b486592c1ee61f5ba32e0
5ed28e9f1b872ecd4021d704cca19f68
b49e1a6b88f34dddff87bca8260f8a8e"

echo ""
echo "  LOOKING FOR SEVEN LOST DOCUMENTS   (read only)"
echo "  ------------------------------------------------------------------"

# 1. The whole host, which covers /var/lib/docker/volumes and every container
#    layer mounted under /var/lib/docker/overlay2.
echo ""
echo "  1. Searching the whole filesystem (this takes a minute)"
FOUND=0
for f in $FILES; do
  HIT=$(find / -name "${f}*" -type f 2>/dev/null | head -5)
  if [ -n "$HIT" ]; then
    echo "     FOUND $f"
    echo "$HIT" | sed 's/^/         /'
    FOUND=$((FOUND + 1))
  fi
done
[ "$FOUND" -eq 0 ] && echo "     none of the seven are anywhere on this machine"

# 2. Every Docker volume, listed with what it holds at the top level. An old
#    uploads volume would show photos/ and covers/ beside the loose PDFs.
echo ""
echo "  2. What each Docker volume contains at its root"
echo "  ------------------------------------------------------------------"
for v in $(docker volume ls -q 2>/dev/null); do
  CONTENT=$(docker run --rm -v "$v":/vol alpine sh -c 'ls /vol 2>/dev/null | head -6' 2>/dev/null | tr '\n' ' ')
  SIZE=$(docker run --rm -v "$v":/vol alpine sh -c 'du -sh /vol 2>/dev/null | cut -f1' 2>/dev/null)
  printf "     %-64s %-6s %s\n" "$(echo "$v" | cut -c1-64)" "${SIZE:-?}" "${CONTENT:-empty}"
done

# 3. Anything that looks like a backup somebody made and forgot.
echo ""
echo "  3. Backup-shaped files on the host"
echo "  ------------------------------------------------------------------"
find /root /home /var/backups /opt /srv -maxdepth 4 \
  \( -name "*.tar.gz" -o -name "*.tar" -o -name "*upload*" -o -name "*backup*" \) \
  2>/dev/null | head -20 | sed 's/^/     /'

echo ""
echo "  Nothing above was modified."
echo "  A hit in section 1 means the bytes still exist and can be restored."
echo ""
