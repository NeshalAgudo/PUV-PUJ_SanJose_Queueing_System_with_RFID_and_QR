const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;

const printService = {
  printTicket: async (ticketData) => {
    try {
      // Initialize printer
      const printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,  // Change to STAR if needed
        interface: process.env.PRINTER_NAME || '', // Use system default if not specified
        options: {
          timeout: 5000
        }
      });

      // Format ticket content - similar to your original style
      printer.alignCenter();
      printer.bold(true);
      printer.println("T.C.P.U.S");
      printer.println("SanJose City");
      printer.bold(false);
      printer.newLine();
      
      printer.alignLeft();
      printer.println(`Date: ${new Date().toLocaleDateString()}`);
      
      if (ticketData.route) {
        printer.println(`Route: ${ticketData.route}`);
      }
      
      if (ticketData.FD) {
        printer.println(ticketData.FD);
      }
      
      if (ticketData.pass) {
        printer.println(ticketData.pass);
      }
      
      if (ticketData.queueNumber) {
        printer.println(`Queue #: ${ticketData.queueNumber}`);
      }
      
      printer.println(`Time In: ${ticketData.timeIn.toLocaleTimeString()}`);
      
      if (ticketData.timeOut) {
        printer.println(`Time Out: ${ticketData.timeOut.toLocaleTimeString()}`);
      }

      printer.newLine();
      printer.alignCenter();
      printer.println("Thank you!");
      printer.cut();

      // Execute print and return promise
      return new Promise((resolve, reject) => {
        printer.execute((err) => {
          if (err) {
            console.error('Print error:', err);
            reject(err);
          } else {
            console.log('Print success!');
            resolve(true);
          }
        });
      });
      
    } catch (error) {
      console.error('Print error:', error);
      throw error;
    }
  }
};

module.exports = printService;