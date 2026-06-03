# Scripts

## Bootstrap First Admin

The first admin user must be granted the admin role manually after registering via the API,
because the API only creates `athlete` role by default and there is no way to grant admin from
the API without already being an admin.

### Via mongosh (production or dev mongo):

```bash
# Connect to your mongo instance
mongosh "mongodb://localhost:27017/badminton"

# Grant admin role to the first registered user
db.users.updateOne(
  { email: "your-admin@example.com" },
  { $set: { globalRole: "admin" } }
)
```

### Via docker-compose (dev):

```bash
docker-compose exec mongo mongosh badminton \
  --eval 'db.users.updateOne({ email: "your-admin@example.com" }, { $set: { globalRole: "admin" } })'
```

After this, the user can login normally and access admin endpoints
(`GET /admin/users`, `PATCH /admin/users/:id/role`, etc.).
