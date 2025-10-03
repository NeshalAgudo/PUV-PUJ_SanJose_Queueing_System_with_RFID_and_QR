const Vehicle = require('../models/Vehicle');

class VehicleStatusService {
  constructor() {
    this.isRunning = false;
    this.lastRunDate = null; // Track the last date we ran updates
  }

  async updateVehicleStatuses() {
    if (this.isRunning) {
      console.log('Vehicle status update is already running...');
      return;
    }

    this.isRunning = true;
    const now = new Date();
    console.log('🚗 Starting vehicle status check...', now.toISOString());

    try {
      // Get current date in Philippine time (for date comparison)
      const phTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Manila"}));
      const today = new Date(phTime);
      today.setHours(0, 0, 0, 0); // Start of today in PH time
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1); // Start of tomorrow

      console.log(`📅 Today's date (PH Time): ${today.toISOString().split('T')[0]}`);

      // Only run if we haven't run today OR if server was asleep
      const todayString = today.toISOString().split('T')[0];
      const shouldRun = !this.lastRunDate || this.lastRunDate !== todayString;

      if (!shouldRun) {
        console.log('✅ Status update already completed today, skipping...');
        return;
      }

      // UPDATE 1: Check for vehicles that expired TODAY (based on expiryDate)
      const expiryUpdateResult = await Vehicle.updateMany(
        {
          expiryDate: {
            $gte: today,    // On or after today 00:00
            $lt: tomorrow   // Before tomorrow 00:00
          },
          status: 'Ok'      // Only update if currently Ok
        },
        {
          $set: { 
            status: 'Expired',
            updatedAt: new Date()
          }
        }
      );

      console.log(`✅ Updated ${expiryUpdateResult.modifiedCount} vehicles to Expired status`);

      // UPDATE 2: Check for vehicles that expired ANY DAY (catch-up for when server was asleep)
      const catchUpExpiryResult = await Vehicle.updateMany(
        {
          expiryDate: {
            $lt: today      // Any date before today (past expiry)
          },
          status: 'Ok'      // Only update if still marked as Ok
        },
        {
          $set: { 
            status: 'Expired',
            updatedAt: new Date()
          }
        }
      );

      console.log(`✅ Catch-up: Updated ${catchUpExpiryResult.modifiedCount} overdue vehicles to Expired status`);

      // UPDATE 3: Check vehicles with penaltyStatus 'Lifted' for 24+ hours
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const penaltyUpdateResult = await Vehicle.updateMany(
        {
          penaltyStatus: 'Lifted',
          $or: [
            { updatedAt: { $lte: twentyFourHoursAgo } },
            { createdAt: { $lte: twentyFourHoursAgo } } // Fallback if no updatedAt
          ]
        },
        {
          $set: { 
            penaltyStatus: 'None',
            updatedAt: new Date()
          }
        }
      );

      console.log(`✅ Updated ${penaltyUpdateResult.modifiedCount} vehicles penalty status from Lifted to None`);

      // Mark today as completed
      this.lastRunDate = todayString;
      console.log('🎉 Daily vehicle status update completed successfully');

      // Log summary
      const totalUpdates = expiryUpdateResult.modifiedCount + catchUpExpiryResult.modifiedCount + penaltyUpdateResult.modifiedCount;
      console.log(`📊 Total vehicles updated: ${totalUpdates}`);

    } catch (error) {
      console.error('❌ Error updating vehicle statuses:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Check if we need to run updates based on date
  shouldRunUpdates() {
    if (!this.lastRunDate) return true; // Never run before
    
    const now = new Date();
    const phTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Manila"}));
    const todayString = phTime.toISOString().split('T')[0];
    
    return this.lastRunDate !== todayString;
  }

  // Initialize the service
  startDailyCheck() {
    console.log('🚗 Starting Vehicle Status Service...');
    
    // Run immediately when server starts (after short delay for DB connection)
    setTimeout(() => {
      console.log('🔍 Performing initial status check...');
      this.updateVehicleStatuses();
    }, 15000); // 15 seconds after server start

    // Check every hour to catch server wake-ups
    setInterval(() => {
      if (this.shouldRunUpdates()) {
        console.log('🔄 Server woke up - checking for pending updates...');
        this.updateVehicleStatuses();
      }
    }, 60 * 60 * 1000); // Check every hour

    // Also run daily at 2:00 AM PH Time as primary schedule
    this.scheduleDailyRun();

    console.log('✅ Vehicle Status Service started successfully');
    console.log('📅 Will run: On startup, every hour, and daily at 2:00 AM PH Time');
  }

  // Schedule daily run at specific time
  scheduleDailyRun() {
    const now = new Date();
    const phTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Manila"}));
    
    // Calculate milliseconds until 2:00 AM PH Time
    const targetTime = new Date(phTime);
    targetTime.setHours(2, 0, 0, 0);
    
    if (phTime >= targetTime) {
      targetTime.setDate(targetTime.getDate() + 1); // Schedule for tomorrow
    }
    
    const msUntilTarget = targetTime.getTime() - phTime.getTime();
    
    console.log(`⏰ Next scheduled run at: ${targetTime.toISOString()} (in ${Math.round(msUntilTarget/1000/60)} minutes)`);
    
    setTimeout(() => {
      this.updateVehicleStatuses();
      // After first run, set up daily interval
      setInterval(() => {
        this.updateVehicleStatuses();
      }, 24 * 60 * 60 * 1000);
    }, msUntilTarget);
  }

  // Manual trigger for testing or admin use
  async manualUpdate() {
    console.log('👤 Manual vehicle status update triggered...');
    this.lastRunDate = null; // Force run
    await this.updateVehicleStatuses();
  }

  // Get service status
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunDate: this.lastRunDate,
      nextCheck: new Date(Date.now() + 60 * 60 * 1000) // Next hourly check
    };
  }
}

module.exports = new VehicleStatusService();