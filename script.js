let subscribeButton = document.querySelector('.subscribe-button');

subscribeButton.addEventListener('click', function(){
  
        // Get the value from the email input field
        var email = document.getElementById("email").value;

        // Regular expression for a valid email address
        var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        // Check if the email is not empty and matches the regular expression
        if (email.trim() !== '' && emailRegex.test(email)) {
            // Display a success alert
            alert("Thank you for subscrbing!");
        } else {
            // Display an error message
            alert("Please enter a valid email address.");
        }

        // Prevent the form from submitting
        return false;
    }
);

