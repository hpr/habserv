module.exports = {
  getAge: (birthday, year = String(new Date().getFullYear())) => {
    const ageDifMs = new Date(year) - birthday.getTime();
    const ageDate = new Date(ageDifMs);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  },
  nth: (n) => {
    return n + (["st", "nd", "rd"][((((n + 90) % 100) - 10) % 10) - 1] || "th");
  },
};
