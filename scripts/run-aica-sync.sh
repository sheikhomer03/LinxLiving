#!/bin/bash
LOG_FILE="/Users/niazig/Desktop/linxliving/LinxLiving/.scratch/aica/overall-import.log"

echo "========================================" > $LOG_FILE
echo "       DB2 IMPORT PROGRESS              " >> $LOG_FILE
echo "========================================" >> $LOG_FILE
cat /Users/niazig/Desktop/linxliving/LinxLiving/.scratch/aica/import-progress.log >> $LOG_FILE

echo "" >> $LOG_FILE
echo "========================================" >> $LOG_FILE
echo "       SHOPIFY SYNC PROGRESS            " >> $LOG_FILE
echo "========================================" >> $LOG_FILE
echo "Starting Shopify Sync for Aica Bathrooms..." | tee -a $LOG_FILE
BRAND="Aica Bathrooms" node scripts/shopify-sync-brand.cjs 2>&1 | tee -a $LOG_FILE

echo "" >> $LOG_FILE
echo "========================================" >> $LOG_FILE
echo "       SHOPIFY IMAGE HARVEST            " >> $LOG_FILE
echo "========================================" >> $LOG_FILE
BRAND="Aica Bathrooms" THEN_REWRITE=1 node scripts/shopify-harvest-brand-images.cjs 2>&1 | tee -a $LOG_FILE

echo "" >> $LOG_FILE
echo "All steps complete! See log above." | tee -a $LOG_FILE
