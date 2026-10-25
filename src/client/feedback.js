// Page feedback: shown once this script can take an answer. A rating shows its note and goes out as a
// `sourcey:feedback` event, `{ value, page }`, for the site's own script to send where it keeps feedback.
document.querySelectorAll('[data-sourcey-feedback]').forEach(function (question) {
  var ratings = question.querySelectorAll('.sourcey-feedback-rating');
  question.hidden = false;
  ratings.forEach(function (rating) {
    rating.addEventListener('click', function () {
      ratings.forEach(function (other) {
        other.disabled = true;
        other.setAttribute('aria-pressed', String(other === rating));
      });
      var note = question.querySelector('.sourcey-feedback-note[data-rating="' + rating.dataset.rating + '"]');
      if (note) note.hidden = false;
      question.dispatchEvent(new CustomEvent('sourcey:feedback', {
        bubbles: true,
        detail: { value: JSON.parse(rating.dataset.value), page: location.pathname },
      }));
    });
  });
});
