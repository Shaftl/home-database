// permit roles: e.g. permit('superadmin'), permit('adminA','adminB')
exports.permit =
  (...allowed) =>
  (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ message: "Not authenticated" });
    if (allowed.includes(req.user.role)) return next();
    return res.status(403).json({ message: "Forbidden - insufficient role" });
  };
