document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab-item[data-tab]');
  const panels = document.querySelectorAll('.tab-panel');

  const showPanel = (selectedTab) => {
    tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === selectedTab);
    });

    panels.forEach((panel) => {
      const isActive = panel.dataset.panel === selectedTab;
      panel.classList.toggle('active', isActive);

      const iframe = panel.querySelector('iframe.embedded-page');
      const pageUrl = document.querySelector(`.tab-item[data-tab="${selectedTab}"]`)?.dataset.page || '';

      if (isActive && pageUrl) {
        if (iframe) {
          iframe.src = pageUrl;
          iframe.style.display = 'block';
        }
      } else if (iframe) {
        iframe.removeAttribute('src');
        iframe.style.display = 'none';
      }
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      showPanel(tab.dataset.tab);
    });
  });

  showPanel('todo');
});
