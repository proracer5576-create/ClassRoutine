const progress = document.querySelector("#readingProgress");
const sections = [...document.querySelectorAll(".manual-section")];
const navLinks = [...document.querySelectorAll("#guideNav a")];

function updateGuidePosition() {
  const available = document.documentElement.scrollHeight - innerHeight;
  progress.style.width = `${available > 0 ? scrollY / available * 100 : 0}%`;
  let active = sections[0]?.id;
  sections.forEach(section => { if (section.getBoundingClientRect().top <= 150) active = section.id; });
  navLinks.forEach(link => link.classList.toggle("active", link.hash === `#${active}`));
}

document.querySelector("#printGuide").addEventListener("click", () => window.print());
addEventListener("scroll", updateGuidePosition, { passive:true });
addEventListener("resize", updateGuidePosition);
updateGuidePosition();
